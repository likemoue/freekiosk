import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resetRateLimits } from '../src/common/rate-limit';
import { COMMANDS, CONFIG_COMMANDS, HOME_APPS_COMMAND } from '../src/devices/catalog';
import { fakeApk } from './apk-fixture';
import { AdminClient, adminClient, FakeTablet, newToken, startServer, TestServer, uploadInParts } from './helpers';

const CAPABLE_OF_ALL = [...new Set(Object.values(COMMANDS).flatMap((spec) => (spec.capability ? [spec.capability] : [])))];

const PARAMS: Record<string, Record<string, unknown>> = {
  speak: { text: 'Xin chào' },
  play_sound: { url: 'https://example.com/a.mp3' },
  set_volume: { percent: '50' },
  clear_app_data: { packages: ['vn.iclass'], labels: ['iCLASS'] },
  set_screen_timeout: { seconds: '300' },
  toast: { message: 'Bảo trì lúc 17:00' },
  execute_js: { code: 'void 0' },
  launch_app: { package_name: 'vn.iclass', label: 'iCLASS' },
  add_wifi_network: { ssid: 'Truong', password: 'khong-duoc-luu' },
  set_url: { url: 'https://example.com/moi' },
  set_brightness: { percent: '70' },
};

describe('the history of commands', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  const enrolled = async (capabilities: string[] = CAPABLE_OF_ALL) => {
    // Enrollment is limited per address, and this suite enrolls far more tablets than anyone would
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    // No heartbeat here: the fake one reports a list of its own
    await tablet.enroll((await newToken(admin)).token, capabilities);
    return tablet;
  };

  const historyOf = (tablet: FakeTablet) => admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`);
  const activityOf = (tablet: FakeTablet) => server.prisma.activityLog.findMany({ where: { deviceId: tablet.deviceId } });

  /** The tablet takes the change, then reports it has it: what closes a line sent through the settings */
  const confirm = async (tablet: FakeTablet) => {
    await tablet.heartbeat();
    await tablet.heartbeat();
  };

  describe('everything on the Commands page', () => {
    it('is something the server knows', async () => {
      const page = await readFile(resolve(process.cwd(), '../web/src/components/commands.tsx'), 'utf8');
      const list = page.slice(page.indexOf('const COMMANDS: CommandDef[]'), page.indexOf('const CATEGORIES'));
      // A command starts its line with its type. The type of a parameter comes after the name
      const offered = [...list.matchAll(/^\s*(?:\{\s*)?type: '([a-z_]+)'/gm)].map((match) => match[1]).sort();
      const known = [...Object.keys(COMMANDS), ...Object.keys(CONFIG_COMMANDS), HOME_APPS_COMMAND].sort();
      assert.deepEqual(offered, known);
    });

    for (const type of [...Object.keys(COMMANDS), ...Object.keys(CONFIG_COMMANDS)]) {
      it(`leaves a line and an entry in the log: ${type}`, async () => {
        const tablet = await enrolled();
        const result = await admin.json('POST', '/api/admin/commands', { type, params: PARAMS[type] ?? {}, target: { deviceIds: [tablet.deviceId] } });
        assert.equal(result.sent, 1);

        const [line, ...others] = await historyOf(tablet);
        assert.equal(others.length, 0);
        assert.equal(line.type, type);
        assert.equal(line.createdBy, 'admin@test.local');
        assert.equal(line.batchId, result.batchId);
        assert.ok(['PENDING', 'SENT'].includes(line.status));
        assert.ok(!JSON.stringify(line).includes('khong-duoc-luu'));

        const entries = await activityOf(tablet);
        assert.ok(entries.some((entry) => entry.action === 'command.queued' && (entry.data as any).batchId === result.batchId));
      });
    }

    it('says so for a tablet left out, with the reason', async () => {
      const tablet = await enrolled(['brightness']);
      const result = await admin.json('POST', '/api/admin/commands', { type: 'stop_apps', target: { deviceIds: [tablet.deviceId] } });
      assert.equal(result.sent, 0);
      const [line] = await historyOf(tablet);
      assert.equal(line.status, 'ERROR');
      assert.ok(line.errorMessage);
    });

    it('logs who cancelled a command', async () => {
      const tablet = await enrolled();
      await admin.json('POST', '/api/admin/commands', { type: 'reload', target: { deviceIds: [tablet.deviceId] } });
      const [line] = await historyOf(tablet);
      await admin.json('POST', `/api/admin/commands/${line.id}/cancel`);
      assert.equal((await historyOf(tablet))[0].status, 'CANCELLED');
      const entry = (await activityOf(tablet)).find((row) => row.action === 'command.cancelled');
      assert.ok(entry?.message.includes('Tải lại'));
      assert.equal(entry?.userEmail, 'admin@test.local');
    });

    it('names a failed command in words in the log', async () => {
      const tablet = await enrolled();
      await admin.json('POST', '/api/admin/commands', { type: 'reload', target: { deviceIds: [tablet.deviceId] } });
      const [{ id }] = ((await (await tablet.get('commands')).json()) as any).commands;
      await tablet.sendResult(id, 'error', null, 'No screen');
      const entry = (await activityOf(tablet)).find((row) => row.action === 'command.failed');
      assert.ok(entry?.message.includes('Tải lại'));
      assert.ok(entry?.message.includes('No screen'));
    });
  });

  describe('what reaches a tablet from other pages', () => {
    const profile = (name: string, config: Record<string, unknown> = { security: { returnMode: 'button' } }) =>
      admin.json('POST', '/api/admin/profiles', { name, config });

    it('a change on its settings page: the names of the settings and never their values', async () => {
      const tablet = await enrolled();
      await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}/config`, {
        config: { security: { returnMode: 'button' }, general: { url: 'https://rieng-tu.example.com' } },
        sensitive: { pin: '4321' },
      });

      const [line, ...others] = await historyOf(tablet);
      assert.equal(others.length, 0);
      assert.equal(line.type, 'push_config');
      assert.equal(line.status, 'SENT');
      assert.equal(line.createdBy, 'admin@test.local');
      assert.deepEqual(line.params, { settings: ['security.returnMode', 'general.url'], secrets: ['pin'] });
      const text = JSON.stringify(line);
      assert.ok(!text.includes('4321') && !text.includes('rieng-tu'));

      await confirm(tablet);
      assert.equal((await historyOf(tablet))[0].status, 'SUCCESS');
    });

    it('a profile given to it, and sent to it again, from its page', async () => {
      const tablet = await enrolled();
      const { id } = await profile('Hồ sơ riêng');
      await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}`, { profileId: id });
      await admin.json('POST', `/api/admin/devices/${tablet.deviceId}/apply-profile`);

      const lines = await historyOf(tablet);
      assert.deepEqual(lines.map((line) => line.type), ['apply_profile', 'apply_profile']);
      assert.deepEqual(lines.map((line) => line.params.profile), ['Hồ sơ riêng', 'Hồ sơ riêng']);

      await confirm(tablet);
      assert.deepEqual((await historyOf(tablet)).map((line) => line.status), ['SUCCESS', 'SUCCESS']);
    });

    it('a profile saved or sent again from the Profiles page, with one batch for all its tablets', async () => {
      const first = await enrolled();
      const second = await enrolled();
      const { id } = await profile('Hồ sơ chung', { general: { autoReload: true } });
      for (const tablet of [first, second]) await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}`, { profileId: id });

      await admin.json('POST', `/api/admin/profiles/${id}/apply`);
      const [one, two] = [(await historyOf(first))[0], (await historyOf(second))[0]];
      assert.equal(one.type, 'apply_profile');
      assert.equal(one.batchId, two.batchId);

      await admin.json('PUT', `/api/admin/profiles/${id}`, { name: 'Hồ sơ chung', config: { general: { autoReload: false } } });
      assert.equal((await historyOf(first)).length, 3);
    });

    it('a profile that comes with a group', async () => {
      const tablet = await enrolled();
      const { id } = await profile('Hồ sơ của nhóm');
      const group = await admin.json('POST', '/api/admin/groups', { name: 'Lớp thử', profileId: id });
      await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}`, { groupId: group.id });
      assert.equal((await historyOf(tablet))[0].params.profile, 'Hồ sơ của nhóm');

      const other = await profile('Hồ sơ mới của nhóm', { general: { autoReload: true } });
      await admin.json('PATCH', `/api/admin/groups/${group.id}`, { profileId: other.id });
      const [line] = await historyOf(tablet);
      assert.equal(line.type, 'apply_profile');
      assert.equal(line.params.profile, 'Hồ sơ mới của nhóm');
    });

    it('does not note a profile that leaves it nothing to apply, since nothing would ever close the line', async () => {
      const tablet = await enrolled();
      const { id } = await profile('Hồ sơ trống', {});
      await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}`, { profileId: id });
      assert.deepEqual(await historyOf(tablet), []);
    });

    it('an APK: the tablets left out are in the history too, in the same batch', async () => {
      const able = await enrolled(['silent_install']);
      const unable = await enrolled(['brightness']);
      const uploadId = await uploadInParts(admin, server.base, 'lich-su.apk', fakeApk({ package: 'vn.lichsu', versionName: '1.0' }), 'apk');
      const apk = await admin.json('POST', `/api/admin/apks/finish/${uploadId}`, {});

      const result = await admin.json('POST', `/api/admin/apks/${apk.id}/deploy`, { target: { deviceIds: [able.deviceId, unable.deviceId] } });
      assert.equal(result.sent, 1);
      assert.equal(result.skipped.length, 1);

      const [sent] = await historyOf(able);
      const [skipped] = await historyOf(unable);
      assert.equal(sent.status, 'PENDING');
      assert.equal(skipped.status, 'ERROR');
      assert.ok(skipped.errorMessage.includes('Device Owner'));
      assert.equal(sent.batchId, skipped.batchId);
      assert.deepEqual(await (await unable.get('updates')).json(), []);

      const entry = await server.prisma.activityLog.findFirst({ where: { action: 'apk.deployed' }, orderBy: { createdAt: 'desc' } });
      assert.ok(entry?.message.includes('bỏ qua 1 thiết bị'));
    });
  });
});
