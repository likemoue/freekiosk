import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { resetRateLimits } from '../src/common/rate-limit';
import { fakeApk, fakeArchive } from './apk-fixture';
import { AdminClient, adminClient, FakeTablet, newToken, startServer, TestServer } from './helpers';

const ALL = ['screen', 'silent_install', 'split_install', 'uninstall_app', 'pull_apk', 'remote_view', 'device_owner'];

describe('apps taken from a tablet, apps removed, and the screen live', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  const enrolled = async (capabilities = ALL) => {
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin)).token, capabilities);
    return tablet;
  };
  /** A heartbeat that keeps the capabilities: the fake tablet's own telemetry lists older ones */
  const beat = (tablet: FakeTablet, extra: Record<string, unknown> = {}, capabilities = ALL) => {
    const telemetry = tablet.telemetry();
    return tablet.heartbeat(extra, { ...telemetry, app: { ...telemetry.app, capabilities } });
  };
  const send = (type: string, params: Record<string, unknown>, deviceIds: string[]) =>
    admin.request('POST', '/api/admin/commands', { type, params, target: { deviceIds } });
  const take = async (tablet: FakeTablet) => ((await (await tablet.get('commands')).json()) as any).commands as any[];
  const device = (tablet: FakeTablet, method: string, path: string, body?: unknown, raw?: Buffer) =>
    fetch(`${server.base}/api/v1/devices/${tablet.deviceId}/${path}`, {
      method,
      headers: { ...tablet.auth(), 'Content-Type': raw ? 'application/octet-stream' : 'application/json' },
      body: raw ? new Uint8Array(raw) : body === undefined ? undefined : JSON.stringify(body),
    });

  /** As ApkExportModule.kt does it: started, in two parts, finished */
  const pull = async (tablet: FakeTablet, commandId: string, content: Buffer, fileName = 'vn.iclass.apk') => {
    const started = await device(tablet, 'POST', 'apk-uploads/', { command_id: commandId, file_name: fileName, size_bytes: content.length });
    assert.equal(started.status, 200, await started.clone().text());
    const { upload_id } = (await started.json()) as any;
    const half = Math.ceil(content.length / 2);
    for (let offset = 0; offset < content.length; offset += half) {
      const part = await device(tablet, 'PUT', `apk-uploads/${upload_id}/part/?offset=${offset}`, undefined, content.subarray(offset, offset + half));
      assert.equal(part.status, 200, await part.clone().text());
    }
    const finished = await device(tablet, 'POST', `apk-uploads/${upload_id}/finish/`, {});
    return { status: finished.status, body: (await finished.json()) as any };
  };

  describe('taking the APK of an app from a tablet', () => {
    it('files it in the library under the app\'s name and the tablet it came from, once', async () => {
      const tablet = await enrolled();
      assert.equal((await send('pull_apk', { package_name: 'vn.iclass', label: 'iCLASS' }, [tablet.deviceId])).status, 201);
      const [command] = await take(tablet);
      assert.equal(command.type, 'pull_apk');

      const apk = fakeApk({ package: 'vn.iclass', versionName: '1.8.3', versionCode: 12 });
      const { status, body } = await pull(tablet, command.id, apk);
      assert.equal(status, 200);
      assert.equal(body.already_in_library, false);
      assert.equal(body.file_name, 'iCLASS 1.8.3.apk');
      const row = await server.prisma.apkPackage.findUniqueOrThrow({ where: { id: body.apk_id } });
      assert.equal(row.packageName, 'vn.iclass');
      assert.match(row.notes ?? '', /Lấy từ/);

      // The same file again is not a second copy
      await send('pull_apk', { package_name: 'vn.iclass', label: 'iCLASS' }, [tablet.deviceId]);
      const [again] = await take(tablet);
      const second = await pull(tablet, again.id, apk);
      assert.equal(second.body.already_in_library, true);
      assert.equal(second.body.apk_id, body.apk_id);
      assert.equal(await server.prisma.apkPackage.count({ where: { packageName: 'vn.iclass' } }), 1);
    });

    it('takes an app of several APKs as one set', async () => {
      const tablet = await enrolled();
      await send('pull_apk', { package_name: 'vn.bo', label: 'Bộ' }, [tablet.deviceId]);
      const [command] = await take(tablet);
      const set = fakeArchive({
        'base.apk': fakeApk({ package: 'vn.bo', versionName: '2.0', versionCode: 20 }),
        'split_config.arm64_v8a.apk': fakeApk({ package: 'vn.bo', versionName: '2.0', versionCode: 20, split: 'config.arm64_v8a' }),
      });
      const { status, body } = await pull(tablet, command.id, set, 'vn.bo.zip');
      assert.equal(status, 200, JSON.stringify(body));
      assert.equal(body.file_name, 'Bộ 2.0.zip');
      const row = await server.prisma.apkPackage.findUniqueOrThrow({ where: { id: body.apk_id } });
      assert.match(row.storageKey, /\.zip$/);
    });

    it('is for one tablet at a time', async () => {
      const [one, two] = [await enrolled(), await enrolled()];
      const response = await send('pull_apk', { package_name: 'vn.iclass', label: 'iCLASS' }, [one.deviceId, two.deviceId]);
      assert.equal(response.status, 400);
    });

    it('takes a file only for a command this tablet was sent, and only from it', async () => {
      const [mine, other] = [await enrolled(), await enrolled()];
      const refused = await device(mine, 'POST', 'apk-uploads/', { command_id: '01a1aed6-fdfe-725a-8ad1-d381403ddc6d', file_name: 'x.apk', size_bytes: 10 });
      assert.equal(refused.status, 404);

      await send('pull_apk', { package_name: 'vn.iclass', label: 'iCLASS' }, [mine.deviceId]);
      const [command] = await take(mine);
      const started = (await (await device(mine, 'POST', 'apk-uploads/', { command_id: command.id, file_name: 'vn.iclass.apk', size_bytes: 100 })).json()) as any;
      const stolen = await fetch(`${server.base}/api/v1/devices/${mine.deviceId}/apk-uploads/${started.upload_id}/part/?offset=0`, {
        method: 'PUT',
        headers: { ...other.auth(), 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(Buffer.alloc(100)),
      });
      assert.equal(stolen.status, 401);
    });
  });

  describe('removing apps', () => {
    it('takes them off the tablet\'s home screen once the tablet says they are gone', async () => {
      const tablet = await enrolled();
      const managedApps = [
        { packageName: 'vn.iclass', displayName: 'iCLASS', showOnHomeScreen: true },
        { packageName: 'vn.ipro', displayName: 'iPro', showOnHomeScreen: true },
      ];
      await beat(tablet, { config: { general: { displayMode: 'external_app', externalApp: { mode: 'multi' }, managedApps } } });

      await server.prisma.device.update({
        where: { id: tablet.deviceId },
        data: { installedApps: [{ package: 'vn.iclass', label: 'iCLASS', version_code: 1 }, { package: 'vn.ipro', label: 'iPro', version_code: 2 }], installedAppsHash: 'h1' },
      });
      const sent = await send('uninstall_app', { packages: ['vn.iclass'], labels: ['iCLASS'] }, [tablet.deviceId]);
      assert.equal(sent.status, 201);
      const [command] = await take(tablet);
      await tablet.sendResult(command.id, 'success', { removed: ['vn.iclass'], missing: [], failed: [] });

      const row = await server.prisma.device.findUniqueOrThrow({ where: { id: tablet.deviceId } });
      assert.deepEqual((row.installedApps as any[]).map((app) => app.package), ['vn.ipro']);
      // Forgotten, so that the tablet's next hash is new and its own list comes again, app put back or not
      assert.equal(row.installedAppsHash, null);
      const pending = (row.pendingConfig as any)?.general?.managedApps;
      assert.deepEqual(pending.map((app: any) => app.packageName), ['vn.ipro']);
      const line = (await admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`)).find((l) => l.type === 'home_apps');
      assert.deepEqual(line.params.remove, ['iCLASS']);
    });

    it('never FreeKiosk itself', async () => {
      const tablet = await enrolled();
      const response = await send('uninstall_app', { packages: ['com.freekiosk'] }, [tablet.deviceId]);
      assert.equal(response.status, 400);
    });
  });

  describe('the screen, live', () => {
    const watch = (deviceIds: string[], mode: 'grid' | 'detail', viewer = 'trang-thu-1') => admin.json<any[]>('POST', '/api/admin/live/watch', { viewer, deviceIds, mode });
    const frame = async (tablet: FakeTablet, jpeg: Buffer, query = 'w=1920&h=1200&control=1') =>
      (await (await device(tablet, 'POST', `live/frame/?${query}`, undefined, jpeg)).json()) as any;

    it('wakes the tablet, shows its last picture, and hands it the taps', async () => {
      const tablet = await enrolled();
      await beat(tablet);
      const waiting = fetch(`${server.base}/api/v1/devices/${tablet.deviceId}/wait/`, { headers: tablet.auth() }).then((r) => r.json());
      await new Promise((done) => setTimeout(done, 100));

      const [status] = await watch([tablet.deviceId], 'grid');
      assert.equal(status.reason, null);
      const woken = (await waiting) as any;
      assert.equal(woken.live, true);

      const first = await frame(tablet, Buffer.from('jpeg-1'));
      assert.equal(first.active, true);
      assert.equal(first.interval_ms, 5000);
      const picture = await admin.request('GET', `/api/admin/live/${tablet.deviceId}/frame`);
      assert.equal(picture.status, 200);
      assert.equal(Buffer.from(await picture.arrayBuffer()).toString(), 'jpeg-1');

      // A tap is only for a screen someone has open full size
      assert.equal((await admin.request('POST', `/api/admin/live/${tablet.deviceId}/input`, { type: 'tap', x: 0.5, y: 0.5 })).status, 400);
      await watch([tablet.deviceId], 'detail', 'trang-thu-2');
      await admin.json('POST', `/api/admin/live/${tablet.deviceId}/input`, { type: 'tap', x: 0.25, y: 0.75 });
      await admin.json('POST', `/api/admin/live/${tablet.deviceId}/input`, { type: 'key', key: 'back' });
      const second = await frame(tablet, Buffer.from('jpeg-2'));
      assert.equal(second.interval_ms, 1000);
      assert.deepEqual(second.inputs.map((input: any) => input.type), ['tap', 'key']);
      assert.equal(second.inputs[0].x, 0.25);
      assert.deepEqual((await frame(tablet, Buffer.from('jpeg-3'))).inputs, []);

      const entry = await server.prisma.activityLog.findFirst({ where: { action: 'live.opened', deviceId: tablet.deviceId } });
      assert.ok(entry?.message.includes('admin@test.local'));
    });

    it('says why there is no picture, and stops the tablet once nobody watches', async () => {
      const tablet = await enrolled();
      await beat(tablet);
      await watch([tablet.deviceId], 'grid', 'trang-thu-3');
      await frame(tablet, Buffer.alloc(0), 'w=1920&h=1200&control=0&problem=screen_off');
      const [status] = await watch([tablet.deviceId], 'grid', 'trang-thu-3');
      assert.equal(status.problem, 'screen_off');
      assert.equal(status.control, false);

      await admin.json('POST', '/api/admin/live/unwatch', { viewer: 'trang-thu-3' });
      assert.equal((await frame(tablet, Buffer.from('jpeg'))).active, false);
    });

    it('does not wake an older app for nothing', async () => {
      const tablet = await enrolled(['screen']);
      await beat(tablet, {}, ['screen']);
      const [status] = await watch([tablet.deviceId], 'grid', 'trang-thu-4');
      assert.equal(status.reason, 'old_app');
    });
  });
});
