import assert from 'node:assert/strict';
import { createServer, IncomingMessage } from 'node:http';
import { createHmac } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { AlertsService } from '../src/alerts/alerts.service';
import { totpCode } from '../src/common/crypto.service';
import { computeNextRun } from '../src/scheduler/next-run';
import { SchedulerService } from '../src/scheduler/scheduler.controller';
import { parseYoutubeId } from '../src/signage/signage.service';
import { ADMIN, adminClient, AdminClient, FakeTablet, newToken, startServer, TestServer } from './helpers';

describe('the dashboard API', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    const first = new AdminClient(server.base);
    assert.equal((await first.login(ADMIN.email, ADMIN.password)).status, 200);
    // The first password has to go before anything else opens
    const blocked = await first.request('GET', '/api/admin/devices');
    assert.equal(blocked.status, 403);
    assert.equal(((await blocked.json()) as any).code, 'PASSWORD_CHANGE_REQUIRED');
    admin = await adminClient(server);
  });
  after(() => server.close());

  describe('sign-in', () => {
    it('refuses a wrong password, with the same answer as an unknown email', async () => {
      const client = new AdminClient(server.base);
      const wrong = await client.login(ADMIN.email, 'wrong');
      const unknown = await client.login('nobody@test.local', 'wrong');
      assert.equal(wrong.status, 401);
      assert.equal(unknown.status, 401);
      assert.equal(((await wrong.json()) as any).message, ((await unknown.json()) as any).message);
    });

    it('says what is wrong with a form in Vietnamese', async () => {
      const response = await admin.request('POST', '/api/admin/users', { email: 'khong-phai-email', name: 'A', role: 'VIEWER' });
      assert.equal(response.status, 400);
      assert.equal(((await response.json()) as any).message, 'Email không hợp lệ');
    });

    it('needs a session for the dashboard API', async () => {
      assert.equal((await fetch(`${server.base}/api/admin/devices`)).status, 401);
    });

    it('refuses an upload part before reading it, with no session or as a viewer', async () => {
      const { id } = await admin.json('POST', '/api/admin/uploads', { fileName: 'a.png', sizeBytes: 3, purpose: 'media' });
      const send = (cookie?: string) =>
        fetch(`${server.base}/api/admin/uploads/${id}/part?offset=0`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'freekiosk-manager', ...(cookie ? { Cookie: cookie } : {}) },
          body: new Uint8Array([1, 2, 3]),
        });
      assert.equal((await send()).status, 401);
      assert.equal((await send('fk_session=not-a-session')).status, 401);
      const { temporaryPassword } = await admin.json('POST', '/api/admin/users', { email: 'xem-tep@test.local', name: 'Xem', role: 'VIEWER' });
      const viewer = new AdminClient(server.base);
      await viewer.login('xem-tep@test.local', temporaryPassword);
      assert.equal((await send(viewer.cookie)).status, 403);
      assert.equal((await send(admin.cookie)).status, 200);
    });

    it('marks the cookie HttpOnly and SameSite=Lax', async () => {
      const response = await fetch(`${server.base}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'freekiosk-manager' },
        body: JSON.stringify({ email: ADMIN.email, password: ADMIN.newPassword }),
      });
      const cookie = response.headers.get('set-cookie') ?? '';
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
    });

    it('refuses a write without the anti-CSRF header', async () => {
      const response = await fetch(`${server.base}/api/admin/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: admin.cookie },
        body: JSON.stringify({ name: 'Từ trang khác' }),
      });
      assert.equal(response.status, 403);
    });

    it('locks an account after five wrong passwords', async () => {
      const created = await admin.json('POST', '/api/admin/users', { email: 'khoa@test.local', name: 'Khóa', role: 'VIEWER' });
      const client = new AdminClient(server.base);
      for (let i = 0; i < 5; i++) assert.equal((await client.login('khoa@test.local', 'wrong')).status, 401);
      assert.equal((await client.login('khoa@test.local', created.temporaryPassword)).status, 403);
    });

    it('turns on two-factor authentication and asks for the code from then on', async () => {
      const { temporaryPassword } = await admin.json('POST', '/api/admin/users', { email: '2fa@test.local', name: 'Hai lớp', role: 'OPERATOR' });
      const client = new AdminClient(server.base);
      await client.login('2fa@test.local', temporaryPassword);
      const password = 'Mat-khau-hai-lop-1';
      await client.json('POST', '/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: password });

      const { secret, otpauthUrl } = await client.json('POST', '/api/admin/auth/2fa/setup');
      assert.match(otpauthUrl, /^otpauth:\/\/totp\//);
      assert.equal((await client.request('POST', '/api/admin/auth/2fa/enable', { code: '000000' })).status, 400);
      const { recoveryCodes } = await client.json('POST', '/api/admin/auth/2fa/enable', { code: totpCode(secret, Date.now()) });
      assert.equal(recoveryCodes.length, 8);

      const next = new AdminClient(server.base);
      const step1 = await next.login('2fa@test.local', password);
      assert.equal(step1.status, 200);
      assert.equal(((await step1.json()) as any).requires2fa, true);
      assert.equal(next.cookie, '');
      assert.equal((await next.login('2fa@test.local', password, '000000')).status, 401);
      assert.equal((await next.login('2fa@test.local', password, totpCode(secret, Date.now()))).status, 200);

      // A recovery code works once
      const recovery = new AdminClient(server.base);
      assert.equal((await recovery.login('2fa@test.local', password, recoveryCodes[0])).status, 200);
      const again = new AdminClient(server.base);
      assert.equal((await again.login('2fa@test.local', password, recoveryCodes[0])).status, 401);
    });

    it('agrees with the RFC 6238 test vector', () => {
      // The ASCII secret of the RFC, in base32
      assert.equal(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59_000), '287082');
    });
  });

  describe('roles', () => {
    let viewer: AdminClient;
    let operator: AdminClient;
    let deviceId: string;

    const signIn = async (email: string, role: string) => {
      const { temporaryPassword } = await admin.json('POST', '/api/admin/users', { email, name: role, role });
      const client = new AdminClient(server.base);
      await client.login(email, temporaryPassword);
      await client.json('POST', '/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: `Mat-khau-${role}-12345` });
      return client;
    };

    before(async () => {
      viewer = await signIn('xem@test.local', 'VIEWER');
      operator = await signIn('vanhanh@test.local', 'OPERATOR');
      const tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token);
      deviceId = tablet.deviceId;
    });

    it('a viewer reads but cannot act', async () => {
      assert.equal((await viewer.request('GET', '/api/admin/devices')).status, 200);
      assert.equal((await viewer.request('POST', '/api/admin/commands', { type: 'reload', target: { deviceIds: [deviceId] } })).status, 403);
      assert.equal((await viewer.request('PATCH', `/api/admin/devices/${deviceId}`, { name: 'x' })).status, 403);
      assert.equal((await viewer.request('GET', '/api/admin/enrollment/tokens')).status, 403);
    });

    it('an operator sends commands, but not the ones that can do the most harm', async () => {
      assert.equal((await operator.request('POST', '/api/admin/commands', { type: 'reload', target: { deviceIds: [deviceId] } })).status, 201);
      assert.equal((await operator.request('POST', '/api/admin/commands', { type: 'execute_js', params: { code: 'alert(1)' }, target: { deviceIds: [deviceId] } })).status, 403);
      assert.equal((await operator.request('POST', '/api/admin/commands', { type: 'add_wifi_network', params: { ssid: 'x', password: 'y' }, target: { deviceIds: [deviceId] } })).status, 403);
      assert.equal((await operator.request('POST', `/api/admin/devices/${deviceId}/unenroll`)).status, 403);
      assert.equal((await operator.request('GET', '/api/admin/users')).status, 403);
    });

    it('the last administrator cannot be removed or demoted', async () => {
      const users: any[] = await admin.json('GET', '/api/admin/users');
      const self = users.find((u) => u.email === ADMIN.email);
      assert.equal((await admin.request('PATCH', `/api/admin/users/${self.id}`, { role: 'VIEWER' })).status, 400);
      assert.equal((await admin.request('DELETE', `/api/admin/users/${self.id}`)).status, 400);
    });
  });

  describe('alerts', () => {
    let received: Array<{ body: string; signature: string | undefined }>;
    let webhook: ReturnType<typeof createServer>;
    let tablet: FakeTablet;

    const settle = () => new Promise((done) => setTimeout(done, 150));

    /** Alerts are worked out after the heartbeat has been answered, so they arrive a moment later */
    const eventually = async (check: () => unknown | Promise<unknown>) => {
      for (let attempt = 0; ; attempt++) {
        try {
          return await check();
        } catch (error) {
          if (attempt >= 40) throw error;
          await new Promise((done) => setTimeout(done, 100));
        }
      }
    };

    before(async () => {
      received = [];
      webhook = createServer((req: IncomingMessage, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          received.push({ body: Buffer.concat(chunks).toString(), signature: req.headers['x-freekiosk-signature'] as string | undefined });
          res.end('ok');
        });
      });
      await new Promise<void>((done) => webhook.listen(0, '127.0.0.1', done));
      const { port } = webhook.address() as AddressInfo;
      await admin.json('POST', '/api/admin/alerts/channels', {
        name: 'Webhook thử',
        type: 'webhook',
        config: { url: `http://127.0.0.1:${port}/hook`, secret: 'khoa-ky' },
      });
      tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token);
    });
    after(() => new Promise<void>((done) => webhook.close(() => done())));

    it('opens one alert for a low battery, signed on the webhook, and closes it on recovery', async () => {
      await tablet.heartbeat({}, tablet.telemetry({ level: 15 }));
      await eventually(() => assert.equal(received.length, 1));
      await tablet.heartbeat({}, tablet.telemetry({ level: 14 }));
      await settle();
      const open = await admin.json('GET', '/api/admin/alerts?state=open');
      const mine = open.filter((a: any) => a.deviceId === tablet.deviceId);
      assert.equal(mine.length, 1);
      assert.equal(mine[0].type, 'battery_low');
      assert.equal(received.length, 1);
      const parsed = JSON.parse(received[0].body);
      assert.equal(parsed.event, 'alert.opened');
      assert.equal(parsed.alertType, 'battery_low');
      assert.equal(received[0].signature, `sha256=${createHmac('sha256', 'khoa-ky').update(received[0].body).digest('hex')}`);

      await tablet.heartbeat({}, tablet.telemetry({ level: 60 }));
      await eventually(() => assert.equal(received.length, 2));
      assert.equal((await admin.json('GET', '/api/admin/alerts?state=open')).filter((a: any) => a.deviceId === tablet.deviceId).length, 0);
      assert.equal(JSON.parse(received[1].body).event, 'alert.resolved');
    });

    it('raises critical alone below the critical level, and storage on its own', async () => {
      await tablet.heartbeat({}, tablet.telemetry({ level: 5, freeStorageMb: 100 }));
      await eventually(async () => {
        const open = (await admin.json('GET', '/api/admin/alerts?state=open')).filter((a: any) => a.deviceId === tablet.deviceId);
        assert.deepEqual(open.map((a: any) => a.type).sort(), ['battery_critical', 'storage_low']);
      });
      await tablet.heartbeat({}, tablet.telemetry({ level: 90 }));
      await eventually(async () => {
        const open = (await admin.json('GET', '/api/admin/alerts?state=open')).filter((a: any) => a.deviceId === tablet.deviceId);
        assert.equal(open.length, 0);
      });
    });

    it('marks a silent tablet offline, then alerts, and clears it when it returns', async () => {
      await tablet.heartbeat();
      await settle();
      const alerts = server.app.get(AlertsService);
      const later = (minutes: number) => Date.now() + minutes * 60_000;

      await alerts.markOffline(later(3));
      let device = await admin.json('GET', `/api/admin/devices/${tablet.deviceId}`);
      assert.equal(device.online, false);
      assert.equal(device.openAlerts.length, 0);

      await alerts.markOffline(later(6));
      device = await admin.json('GET', `/api/admin/devices/${tablet.deviceId}`);
      assert.deepEqual(device.openAlerts.map((a: any) => a.type), ['offline']);

      await tablet.heartbeat();
      await eventually(async () => {
        device = await admin.json('GET', `/api/admin/devices/${tablet.deviceId}`);
        assert.equal(device.online, true);
        assert.equal(device.openAlerts.length, 0);
      });
    });

    it('stays silent for a kind of alert that is switched off', async () => {
      await admin.json('PATCH', '/api/admin/alerts/settings', { disabled: ['storage_low'] });
      await tablet.heartbeat({}, tablet.telemetry({ freeStorageMb: 10 }));
      await settle();
      const open = (await admin.json('GET', '/api/admin/alerts?state=open')).filter((a: any) => a.deviceId === tablet.deviceId);
      assert.equal(open.length, 0);
      await admin.json('PATCH', '/api/admin/alerts/settings', { disabled: [] });
      await tablet.heartbeat();
      await settle();
    });

    it('sends a test message and records the failure of a dead channel', async () => {
      const channels: any[] = await admin.json('GET', '/api/admin/alerts/channels');
      assert.equal(channels[0].hasSecret, true);
      assert.ok(!JSON.stringify(channels).includes('khoa-ky'));
      await admin.json('POST', `/api/admin/alerts/channels/${channels[0].id}/test`);

      const dead = await admin.json('POST', '/api/admin/alerts/channels', { name: 'Chết', type: 'webhook', config: { url: 'http://127.0.0.1:9/none' } });
      assert.equal((await admin.request('POST', `/api/admin/alerts/channels/${dead.id}/test`)).status, 400);
      const after = (await admin.json('GET', '/api/admin/alerts/channels')).find((c: any) => c.id === dead.id);
      assert.ok(after.lastError);
      await admin.json('DELETE', `/api/admin/alerts/channels/${dead.id}`);
    });
  });

  describe('scheduler', () => {
    it('computes the next run in the time zone of the task', () => {
      // Tuesday 3 November 2026, 10:00 in Vietnam (03:00 UTC)
      const now = new Date('2026-11-03T03:00:00Z');
      assert.equal(computeNextRun([2], '11:00', 'Asia/Ho_Chi_Minh', now)?.toISOString(), '2026-11-03T04:00:00.000Z');
      assert.equal(computeNextRun([2], '09:00', 'Asia/Ho_Chi_Minh', now)?.toISOString(), '2026-11-10T02:00:00.000Z');
      assert.equal(computeNextRun([1, 5], '06:30', 'Asia/Ho_Chi_Minh', now)?.toISOString(), '2026-11-05T23:30:00.000Z');
      assert.equal(computeNextRun([], '06:30', 'Asia/Ho_Chi_Minh', now), null);
      // Before UTC midnight, the local day is already the next one
      assert.equal(computeNextRun([3], '07:00', 'Asia/Ho_Chi_Minh', new Date('2026-11-03T18:00:00Z'))?.toISOString(), '2026-11-04T00:00:00.000Z');
    });

    it('sends the command when due, once, and moves on to the next day', async () => {
      const tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token);
      const task = await admin.json('POST', '/api/admin/scheduler/tasks', {
        name: 'Tải lại mỗi sáng',
        commandType: 'reload',
        targetType: 'devices',
        deviceIds: [tablet.deviceId],
        days: [1, 2, 3, 4, 5, 6, 7],
        time: '06:30',
      });
      assert.ok(task.nextRunAt);
      const scheduler = server.app.get(SchedulerService);
      const due = new Date(new Date(task.nextRunAt).getTime() + 1000);
      await scheduler.runDue(due);
      await scheduler.runDue(due);
      const commands = await server.prisma.command.findMany({ where: { deviceId: tablet.deviceId } });
      assert.equal(commands.length, 1);
      assert.equal(commands[0].source, `schedule:${task.id}`);
      const row = await server.prisma.scheduledTask.findUniqueOrThrow({ where: { id: task.id } });
      assert.ok(row.nextRunAt! > due);
    });

    it('refuses to schedule a command that holds a secret or runs code', async () => {
      for (const commandType of ['execute_js', 'add_wifi_network']) {
        const response = await admin.request('POST', '/api/admin/scheduler/tasks', {
          name: 'x', commandType, params: { code: 'a', ssid: 'b', password: 'c' }, targetType: 'all', days: [1], time: '06:30',
        });
        assert.equal(response.status, 400);
      }
    });
  });

  describe('activity and overview', () => {
    it('exports the log as CSV that Excel reads, and defuses formulas', async () => {
      await server.prisma.activityLog.create({ data: { action: 'test.formula', message: '=HYPERLINK("http://x")' } });
      const response = await admin.request('GET', '/api/admin/activity/export.csv?action=test.formula');
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/csv/);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
      const text = bytes.toString('utf8');
      assert.ok(text.includes('Thời gian'));
      assert.ok(text.includes(`"'=HYPERLINK(""http://x"")"`));
    });

    it('sums up the fleet', async () => {
      const overview = await admin.json('GET', '/api/admin/overview');
      assert.equal(typeof overview.totals.devices, 'number');
      assert.equal(overview.totals.online + overview.totals.offline, overview.totals.devices);
      assert.ok(Array.isArray(overview.appVersions));
      assert.ok(Array.isArray(overview.recent));
    });

    it('answers the health check without a session', async () => {
      assert.equal((await fetch(`${server.base}/healthz`)).status, 200);
      const info: any = await (await fetch(`${server.base}/api/public/info`)).json();
      assert.equal(info.organization, 'Tổ chức kiểm thử');
    });
  });

  describe('YouTube addresses', () => {
    it('finds the video in every usual form, and nothing elsewhere', () => {
      const id = 'dQw4w9WgXcQ';
      for (const form of [
        id,
        `https://www.youtube.com/watch?v=${id}&t=10`,
        `https://youtu.be/${id}?si=abc`,
        `https://www.youtube.com/embed/${id}`,
        `https://www.youtube.com/shorts/${id}`,
        `https://m.youtube.com/watch?v=${id}`,
        `https://www.youtube-nocookie.com/embed/${id}`,
      ]) {
        assert.equal(parseYoutubeId(form), id, form);
      }
      for (const bad of ['https://evil.example/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'not a url']) {
        assert.equal(parseYoutubeId(bad), null, bad);
      }
    });
  });

  describe('framing check', () => {
    it('refuses addresses inside the network of the server', async () => {
      for (const url of ['http://127.0.0.1:5448/', 'http://localhost/', 'file:///etc/passwd']) {
        const result = await admin.json('POST', '/api/admin/signage/check-url', { url });
        assert.equal(result.reachable, false, url);
      }
    });
  });
});
