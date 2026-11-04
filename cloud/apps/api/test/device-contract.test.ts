import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { DeviceApiService } from '../src/device-api/device-api.service';
import { adminClient, AdminClient, FakeTablet, newToken, startServer, TestServer, uploadInParts } from './helpers';

// The two checks the app itself applies to a playlist (src/utils/SignagePlaylist.ts)
const YOUTUBE_PLAYER = /^https?:\/\/[^\s?#]+\/player\/youtube\/\?(?:[^\s#]*&)?v=([A-Za-z0-9_-]{11})(?:&[^\s#]*)?$/;
const HTTP_URL = /^https?:\/\/\S+$/i;

describe('the contract of the FreeKiosk app', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  describe('enrollment', () => {
    it('refuses an unknown token, with the reason in `error` as the app shows it', async () => {
      const tablet = new FakeTablet(server.base);
      const result = await tablet.enroll('not-a-real-token');
      assert.equal(result.status, 400);
      assert.equal(typeof result.data.error, 'string');
    });

    it('gives a device id, an API key and the organization name, once per token', async () => {
      const { token } = await newToken(admin);
      const tablet = new FakeTablet(server.base);
      const result = await tablet.enroll(token);
      assert.equal(result.ok, true);
      assert.match(result.data.device_id, /^[0-9a-f-]{36}$/);
      assert.match(result.data.api_key, /^fkd_/);
      assert.equal(result.data.organization_name, 'Tổ chức kiểm thử');

      const again = await new FakeTablet(server.base).enroll(token);
      assert.equal(again.status, 400);
      assert.match(again.data.error, /đã được sử dụng/);
    });

    it('takes a short code as typed, whatever the case', async () => {
      const { token } = await newToken(admin);
      assert.match(token, /^[A-Z2-9]{8}$/);
      assert.equal((await new FakeTablet(server.base).enroll(` ${token.toLowerCase()} `)).ok, true);
    });

    it('stores the API key only as a hash', async () => {
      const { token } = await newToken(admin);
      const tablet = new FakeTablet(server.base);
      await tablet.enroll(token);
      const row = await server.prisma.device.findUniqueOrThrow({ where: { id: tablet.deviceId } });
      assert.notEqual(row.apiKeyHash, tablet.apiKey);
      assert.match(row.apiKeyHash, /^[0-9a-f]{64}$/);
    });

    it('refuses a revoked or expired token', async () => {
      const revoked = await newToken(admin);
      await admin.json('POST', `/api/admin/enrollment/tokens/${revoked.id}/revoke`);
      assert.match((await new FakeTablet(server.base).enroll(revoked.token)).data.error, /thu hồi/);

      const expired = await newToken(admin);
      await server.prisma.enrollmentToken.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.match((await new FakeTablet(server.base).enroll(expired.token)).data.error, /hết hạn/);
    });

    it('lets a multi-use token enroll as many tablets as it says, and no more', async () => {
      const { token } = await newToken(admin, { maxUses: 2 });
      assert.equal((await new FakeTablet(server.base).enroll(token)).ok, true);
      assert.equal((await new FakeTablet(server.base).enroll(token)).ok, true);
      assert.equal((await new FakeTablet(server.base).enroll(token)).ok, false);
    });
  });

  describe('heartbeat', () => {
    let tablet: FakeTablet;
    before(async () => {
      tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token);
    });

    it('answers with every field of HeartbeatResponse', async () => {
      const { status, data } = await tablet.heartbeat();
      assert.equal(status, 200);
      assert.equal(data.status, 'ok');
      assert.equal(data.pending_commands, 0);
      assert.ok(!Number.isNaN(new Date(data.server_time).getTime()));
      assert.equal(data.sync_action, 'none');
      assert.equal(data.config, null);
      assert.equal(data.sensitive_config, null);
      assert.equal(data.config_version, 0);
      assert.equal(data.force_unenroll, false);
      assert.equal(data.playlist_version, null);
    });

    it('accepts the path with and without the trailing slash the app uses', async () => {
      const response = await fetch(`${server.base}/api/v1/devices/${tablet.deviceId}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tablet.auth() },
        body: '{}',
      });
      assert.equal(response.status, 200);
    });

    it('keeps the telemetry for the dashboard', async () => {
      await tablet.heartbeat();
      const device = await admin.json('GET', `/api/admin/devices/${tablet.deviceId}`);
      assert.equal(device.online, true);
      assert.equal(device.batteryLevel, 80);
      assert.equal(device.wifiSsid, 'Truong-A');
      assert.equal(device.ipAddress, '172.16.10.50');
      assert.equal(device.brightness, 70);
      assert.equal(device.deviceOwner, true);
      assert.equal(device.timezone, 'Asia/Ho_Chi_Minh');
      assert.ok(device.capabilities.includes('reboot'));
    });

    it('leaves the battery empty on a TV, which sends no battery key', async () => {
      const { battery: _none, ...withoutBattery } = tablet.telemetry();
      await tablet.heartbeat({}, withoutBattery as ReturnType<FakeTablet['telemetry']>);
      const device = await admin.json('GET', `/api/admin/devices/${tablet.deviceId}`);
      assert.equal(device.batteryLevel, null);
    });

    it('stays accepted with no telemetry at all, which the app allows', async () => {
      const response = await fetch(`${server.base}/api/v1/devices/${tablet.deviceId}/heartbeat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tablet.auth() },
        body: JSON.stringify({ config: {}, config_version: 0 }),
      });
      assert.equal(response.status, 200);
    });

    it('refuses a wrong key with 401 and another device id with 403', async () => {
      const wrong = await fetch(`${server.base}/api/v1/devices/${tablet.deviceId}/heartbeat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer nope' },
        body: '{}',
      });
      assert.equal(wrong.status, 401);
      const other = await fetch(`${server.base}/api/v1/devices/00000000-0000-7000-8000-000000000000/heartbeat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tablet.auth() },
        body: '{}',
      });
      assert.equal(other.status, 403);
    });
  });

  describe('configuration', () => {
    let tablet: FakeTablet;
    before(async () => {
      tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token);
      await tablet.heartbeat();
    });

    it('sends only what changed, then stops once the device confirms', async () => {
      await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}/config`, {
        config: { general: { url: 'https://truong-a.edu.vn/' } },
        sensitive: { pin: '4321' },
      });

      const first = await tablet.heartbeat();
      assert.equal(first.data.sync_action, 'apply');
      assert.deepEqual(first.data.config, { general: { url: 'https://truong-a.edu.vn/' } });
      assert.deepEqual(first.data.sensitive_config, { pin: '4321' });
      assert.equal(first.data.config_version, 1);

      const second = await tablet.heartbeat();
      assert.equal(second.data.sync_action, 'none');
      assert.equal(second.data.config, null);
      const row = await server.prisma.device.findUniqueOrThrow({ where: { id: tablet.deviceId } });
      assert.equal(row.pendingConfig, null);
      assert.equal(row.pendingSensitiveEnc, null);
      assert.ok(row.configSyncedAt);
    });

    it('does not lose a change saved at the moment the device confirms the previous one', async () => {
      await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}/config`, { config: { general: { url: 'https://v-truoc.edu.vn/' } } });
      assert.equal((await tablet.heartbeat()).data.sync_action, 'apply');
      // The confirming heartbeat read the row at the old version, then the save landed
      const guard = await server.prisma.device.findUniqueOrThrow({ where: { id: tablet.deviceId } });
      await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}/config`, { config: { general: { url: 'https://v-sau.edu.vn/' } } });
      const service = server.app.get(DeviceApiService);
      await service.heartbeat(guard, { config_version: guard.configVersion }, null);

      const next = await tablet.heartbeat();
      assert.equal(next.data.sync_action, 'apply');
      assert.equal(next.data.config.general.url, 'https://v-sau.edu.vn/');
      assert.equal((await tablet.heartbeat()).data.sync_action, 'none');
    });

    it('merges changes made while the device is away', async () => {
      await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}/config`, { config: { display: { defaultBrightness: 0.3 } } });
      await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}/config`, { config: { display: { keepScreenOn: true }, general: { autoReload: true } } });
      const { data } = await tablet.heartbeat();
      assert.deepEqual(data.config, { display: { defaultBrightness: 0.3, keepScreenOn: true }, general: { autoReload: true } });
    });

    it('never echoes the secrets of a device back to the browser', async () => {
      await tablet.heartbeat();
      const config = await admin.json('GET', `/api/admin/devices/${tablet.deviceId}/config`);
      const text = JSON.stringify(config);
      assert.ok(!text.includes('mqtt-secret'));
      assert.ok(!text.includes('rest-secret'));
      assert.equal(config.secrets.mqttPassword, true);
      const row = await server.prisma.device.findUniqueOrThrow({ where: { id: tablet.deviceId } });
      assert.ok(row.reportedSensitiveEnc?.startsWith('v1.'));
      assert.ok(!row.reportedSensitiveEnc?.includes('mqtt-secret'));
    });

    it('applies a profile at enrollment, and again to all its devices when it changes', async () => {
      const profile = await admin.json('POST', '/api/admin/profiles', { name: 'Sảnh chính', config: { general: { url: 'https://sanh.edu.vn/' } } });
      const group = await admin.json('POST', '/api/admin/groups', { name: 'Cơ sở 1', profileId: profile.id });
      const { token } = await newToken(admin, { groupId: group.id });
      const member = new FakeTablet(server.base);
      await member.enroll(token);

      const first = await member.heartbeat();
      assert.equal(first.data.sync_action, 'apply');
      assert.deepEqual(first.data.config, { general: { url: 'https://sanh.edu.vn/' } });
      assert.equal((await member.heartbeat()).data.sync_action, 'none');

      const saved = await admin.json('PUT', `/api/admin/profiles/${profile.id}`, { name: 'Sảnh chính', config: { general: { url: 'https://moi.edu.vn/' } } });
      assert.equal(saved.appliedTo, 1);
      const next = await member.heartbeat();
      assert.equal(next.data.sync_action, 'apply');
      assert.deepEqual(next.data.config, { general: { url: 'https://moi.edu.vn/' } });
    });

    it('tells the dashboard which profile a device gets through its group', async () => {
      const profile = await admin.json('POST', '/api/admin/profiles', { name: 'Hồ sơ của nhóm', config: { general: { url: 'https://nhom.edu.vn/' } } });
      const group = await admin.json('POST', '/api/admin/groups', { name: 'Cơ sở có hồ sơ', profileId: profile.id });
      const member = new FakeTablet(server.base);
      await member.enroll((await newToken(admin, { groupId: group.id })).token);

      const detail = await admin.json('GET', `/api/admin/devices/${member.deviceId}`);
      assert.equal(detail.profile, null);
      assert.equal(detail.group.profile.name, 'Hồ sơ của nhóm');
    });

    it('makes a profile from what a device reported, for new tablets to receive', async () => {
      const source = new FakeTablet(server.base);
      await source.enroll((await newToken(admin)).token);
      await source.heartbeat();
      const { reported } = await admin.json('GET', `/api/admin/devices/${source.deviceId}/config`);

      const plain = await admin.json('POST', '/api/admin/profiles', { name: 'Không kèm bí mật', config: reported });
      assert.equal(plain.secrets.mqttPassword, false);

      // What is typed in the form wins over what is copied, and the tablet never reports its PIN
      const copied = await admin.json('POST', '/api/admin/profiles', { name: 'Kèm bí mật', config: reported, copySecretsFromDeviceId: source.deviceId, sensitive: { pin: '5678', restApiKey: 'typed-key' } });
      assert.deepEqual(copied.secrets, { pin: true, mqttPassword: true, restApiKey: true, httpBasicAuthPassword: false });

      const fresh = new FakeTablet(server.base);
      await fresh.enroll((await newToken(admin, { profileId: copied.id })).token);
      const first = await fresh.heartbeat();
      assert.equal(first.data.sync_action, 'apply');
      assert.deepEqual(first.data.config, reported);
      assert.equal(first.data.sensitive_config.mqttPassword, 'mqtt-secret');
      assert.equal(first.data.sensitive_config.restApiKey, 'typed-key');
      assert.equal(first.data.sensitive_config.pin, '5678');
    });

    it('keeps the secrets of a profile that are left empty when saving it', async () => {
      const profile = await admin.json('POST', '/api/admin/profiles', { name: 'Giữ bí mật', config: {}, sensitive: { mqttPassword: 'giu-nguyen' } });
      const saved = await admin.json('PUT', `/api/admin/profiles/${profile.id}`, { name: 'Giữ bí mật', config: {}, sensitive: { pin: '5678' } });
      assert.deepEqual(saved.secrets, { pin: true, mqttPassword: true, restApiKey: false, httpBasicAuthPassword: false });
    });

    it('refuses to copy the secrets of a device that does not exist', async () => {
      const response = await admin.request('POST', '/api/admin/profiles', { name: 'Không có nguồn', config: {}, copySecretsFromDeviceId: '00000000-0000-4000-8000-000000000000' });
      assert.equal(response.status, 404);
      assert.equal((await admin.json('GET', '/api/admin/profiles')).some((p: any) => p.name === 'Không có nguồn'), false);
    });

    it('sends a change to a whole group at once', async () => {
      const group = await admin.json('POST', '/api/admin/groups', { name: 'Cơ sở 2' });
      const a = new FakeTablet(server.base);
      const b = new FakeTablet(server.base);
      await a.enroll((await newToken(admin, { groupId: group.id })).token);
      await b.enroll((await newToken(admin, { groupId: group.id })).token);
      const { count } = await admin.json('POST', '/api/admin/config/apply', { target: { groupId: group.id }, config: { general: { url: 'https://nhom.edu.vn/' } } });
      assert.equal(count, 2);
      assert.equal((await a.heartbeat()).data.sync_action, 'apply');
      assert.equal((await b.heartbeat()).data.sync_action, 'apply');
    });
  });

  describe('commands', () => {
    let tablet: FakeTablet;
    before(async () => {
      tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token);
      await tablet.heartbeat();
    });

    it('goes from pending to sent to a reported result', async () => {
      const sent = await admin.json('POST', '/api/admin/commands', { type: 'toast', params: { message: 'Xin chào' }, target: { deviceIds: [tablet.deviceId] } });
      assert.equal(sent.sent, 1);

      assert.equal((await tablet.heartbeat()).data.pending_commands, 1);

      const list: any = await (await tablet.get('commands')).json();
      assert.equal(list.commands.length, 1);
      const command = list.commands[0];
      assert.equal(command.type, 'toast');
      assert.deepEqual(command.params, { message: 'Xin chào' });
      assert.ok(command.created_at && command.expires_at);

      // Never handed over twice
      assert.equal(((await (await tablet.get('commands')).json()) as any).commands.length, 0);
      assert.equal((await tablet.heartbeat()).data.pending_commands, 0);

      assert.equal((await tablet.sendResult(command.id, 'success', { ok: true })).status, 200);
      const history = await admin.json('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`);
      assert.equal(history[0].status, 'SUCCESS');
      assert.deepEqual(history[0].result, { ok: true });
    });

    it('keeps an error from the device, and a 4xx tells the app to stop retrying', async () => {
      await admin.json('POST', '/api/admin/commands', { type: 'reload', target: { deviceIds: [tablet.deviceId] } });
      const { commands } = (await (await tablet.get('commands')).json()) as any;
      await tablet.sendResult(commands[0].id, 'error', null, 'Không có WebView');
      const history = await admin.json('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`);
      assert.equal(history[0].status, 'ERROR');
      assert.equal(history[0].errorMessage, 'Không có WebView');
      assert.equal((await tablet.sendResult('00000000-0000-7000-8000-000000000000', 'success')).status, 404);
    });

    it('does not hand over a command of another device', async () => {
      await admin.json('POST', '/api/admin/commands', { type: 'reload', target: { deviceIds: [tablet.deviceId] } });
      const { commands } = (await (await tablet.get('commands')).json()) as any;
      const other = new FakeTablet(server.base);
      await other.enroll((await newToken(admin)).token);
      assert.equal((await other.sendResult(commands[0].id, 'success')).status, 404);
    });

    it('delivers the Wi-Fi password to the device only, and only once', async () => {
      await admin.json('POST', '/api/admin/commands', { type: 'add_wifi_network', params: { ssid: 'Truong-B', password: 'mat-khau-wifi' }, target: { deviceIds: [tablet.deviceId] } });
      const history = await admin.json('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`);
      assert.ok(!JSON.stringify(history).includes('mat-khau-wifi'));
      assert.ok(!JSON.stringify(history[0]).includes('secretEnc'));

      const { commands } = (await (await tablet.get('commands')).json()) as any;
      assert.deepEqual(commands[0].params, { ssid: 'Truong-B', password: 'mat-khau-wifi' });
      const row = await server.prisma.command.findUniqueOrThrow({ where: { id: commands[0].id } });
      assert.equal(row.secretEnc, null);
    });

    it('skips a device that lacks the capability, unless it reports none (an older app)', async () => {
      const limited = new FakeTablet(server.base);
      await limited.enroll((await newToken(admin)).token, ['screen']);
      const legacy = new FakeTablet(server.base);
      await legacy.enroll((await newToken(admin)).token, []);
      const result = await admin.json('POST', '/api/admin/commands', { type: 'reboot', target: { deviceIds: [limited.deviceId, legacy.deviceId] } });
      assert.equal(result.sent, 1);
      assert.equal(result.skipped.length, 1);
      assert.equal(result.skipped[0].deviceId, limited.deviceId);
    });

    it('does not hand over an expired command', async () => {
      await admin.json('POST', '/api/admin/commands', { type: 'reload', target: { deviceIds: [tablet.deviceId] } });
      await server.prisma.command.updateMany({ where: { deviceId: tablet.deviceId, status: 'PENDING' }, data: { expiresAt: new Date(Date.now() - 1000) } });
      assert.equal((await tablet.heartbeat()).data.pending_commands, 0);
      assert.equal(((await (await tablet.get('commands')).json()) as any).commands.length, 0);
    });
  });

  describe('screenshots', () => {
    it('takes the multipart upload of the app, and shows the image to a session only', async () => {
      const tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token);
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');
      const form = new FormData();
      form.append('image', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'screenshot.png');
      form.append('captured_at', '2026-11-03T01:02:03.000Z');
      const upload = await fetch(`${server.base}/api/v1/devices/${tablet.deviceId}/screenshot/`, { method: 'POST', headers: tablet.auth(), body: form });
      assert.ok(upload.ok, `HTTP ${upload.status}`);

      const shots = await admin.json('GET', `/api/admin/screenshots?deviceId=${tablet.deviceId}`);
      assert.equal(shots.length, 1);
      assert.equal(shots[0].capturedAt, '2026-11-03T01:02:03.000Z');

      const image = await admin.request('GET', `/api/admin/screenshots/${shots[0].id}/image`);
      assert.equal(image.status, 200);
      assert.equal(image.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);

      assert.equal((await fetch(`${server.base}/api/admin/screenshots/${shots[0].id}/image`)).status, 401);
    });
  });

  describe('digital signage', () => {
    let tablet: FakeTablet;
    let playlistId: string;
    let assetUrl: string;

    before(async () => {
      tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token);
      const content = Buffer.alloc(150_000, 7);
      const uploadId = await uploadInParts(admin, server.base, 'Khai giảng năm học.mp4', content, 'media');
      const asset = await admin.json('POST', `/api/admin/media/finish/${uploadId}`, {});
      assetUrl = asset.url;
      const playlist = await admin.json('POST', '/api/admin/signage/playlists', { name: 'Sảnh' });
      playlistId = playlist.id;
      await admin.json('PUT', `/api/admin/signage/playlists/${playlistId}/items`, {
        items: [
          { kind: 'video', mediaAssetId: asset.id, title: 'Khai giảng' },
          { kind: 'image', url: 'https://cdn.example.com/a.jpg', durationSeconds: 12 },
          { kind: 'web', url: 'https://example.com/lich', durationSeconds: 1 },
          { kind: 'youtube', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
        ],
      });
    });

    it('says there is nothing to play until something is assigned', async () => {
      assert.equal((await tablet.heartbeat()).data.playlist_version, null);
      const manifest: any = await (await tablet.get('playlist')).json();
      assert.equal(manifest.version, null);
      assert.deepEqual(manifest.items, []);
    });

    it('gives a version once assigned, and a manifest the app accepts item by item', async () => {
      await admin.json('PUT', `/api/admin/signage/playlists/${playlistId}/assign`, { deviceIds: [tablet.deviceId], groupIds: [] });
      const { data } = await tablet.heartbeat();
      assert.equal(typeof data.playlist_version, 'string');
      assert.ok(data.playlist_version.length > 0);

      const manifest: any = await (await tablet.get('playlist')).json();
      assert.equal(manifest.version, data.playlist_version);
      assert.equal(manifest.playlist.name, 'Sảnh');
      assert.equal(manifest.schedule, null);
      assert.equal(manifest.items.length, 4);
      for (const item of manifest.items) {
        assert.equal(typeof item.id, 'string');
        assert.match(item.url, HTTP_URL);
      }
      const [video, image, web, youtube] = manifest.items;
      assert.equal(video.kind, 'video');
      assert.equal(video.url, assetUrl);
      assert.equal(image.duration_seconds, 12);
      // A web page never shows for less than 5 seconds
      assert.equal(web.duration_seconds, 5);
      assert.equal(youtube.kind, 'youtube');
      assert.equal(youtube.video_id, 'dQw4w9WgXcQ');
      const match = YOUTUBE_PLAYER.exec(youtube.url);
      assert.ok(match, youtube.url);
      assert.equal(match![1], 'dQw4w9WgXcQ');
    });

    it('keeps the same version for the same content, and a new one when it changes', async () => {
      const before = (await tablet.heartbeat()).data.playlist_version;
      assert.equal((await tablet.heartbeat()).data.playlist_version, before);
      await admin.json('PUT', `/api/admin/signage/playlists/${playlistId}/items`, { items: [{ kind: 'image', url: 'https://cdn.example.com/b.jpg' }] });
      const after = (await tablet.heartbeat()).data.playlist_version;
      assert.notEqual(after, before);
    });

    it('puts schedule rules in the order of precedence the app relies on', async () => {
      const group = await admin.json('POST', '/api/admin/groups', { name: 'Bảng hiệu' });
      await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}`, { groupId: group.id });
      const other = await admin.json('POST', '/api/admin/signage/playlists', { name: 'Buổi tối' });
      await admin.json('PUT', `/api/admin/signage/playlists/${other.id}/items`, { items: [{ kind: 'image', url: 'https://cdn.example.com/c.jpg' }] });
      await admin.json('POST', '/api/admin/signage/rules', { playlistId: other.id, groupId: group.id, days: [1, 2, 3], start: '18:00', end: '22:00', priority: 5 });
      await admin.json('POST', '/api/admin/signage/rules', { playlistId: other.id, deviceId: tablet.deviceId, days: [1], priority: 5, from: '2026-11-01', to: '2026-12-31' });
      await admin.json('POST', '/api/admin/signage/rules', { playlistId: other.id, deviceId: tablet.deviceId, days: [7, 6], priority: 9 });

      const manifest: any = await (await tablet.get('playlist')).json();
      assert.ok(manifest.schedule);
      assert.equal(manifest.schedule.default_playlist, playlistId);
      assert.deepEqual(Object.keys(manifest.schedule.playlists).sort(), [playlistId, other.id].sort());
      assert.equal(manifest.schedule.playlists[other.id].name, 'Buổi tối');
      const rules = manifest.schedule.rules;
      assert.deepEqual(rules[0].days, [6, 7]);
      assert.equal(rules[1].from, '2026-11-01');
      assert.equal(rules[2].start, '18:00');
    });

    it('reports whether the screen is up to date', async () => {
      const wanted = (await tablet.heartbeat()).data.playlist_version;
      let device = await admin.json('GET', `/api/admin/devices/${tablet.deviceId}`);
      assert.equal(device.signage.state, 'not_reported');
      await tablet.heartbeat({}, tablet.telemetry({ playlistVersion: 'an-old-version' }));
      device = await admin.json('GET', `/api/admin/devices/${tablet.deviceId}`);
      assert.equal(device.signage.state, 'waiting');
      await tablet.heartbeat({}, tablet.telemetry({ playlistVersion: wanted }));
      device = await admin.json('GET', `/api/admin/devices/${tablet.deviceId}`);
      assert.equal(device.signage.state, 'up_to_date');
    });

    it('serves a library file with a stable address, resume and revalidation', async () => {
      const path = assetUrl.replace('https://kiosk.test.local', server.base);
      assert.match(path, /\/Khai-giang-nam-hoc\.mp4$/);

      const full = await fetch(path);
      assert.equal(full.status, 200);
      assert.equal(full.headers.get('content-type'), 'video/mp4');
      assert.equal((await full.arrayBuffer()).byteLength, 150_000);
      const etag = full.headers.get('etag');
      assert.ok(etag);

      const part = await fetch(path, { headers: { Range: 'bytes=100-199' } });
      assert.equal(part.status, 206);
      assert.equal((await part.arrayBuffer()).byteLength, 100);

      // cache: 'no-cache', or fetch itself adds "Cache-Control: no-cache", which rules a 304 out
      const same = await fetch(path, { headers: { 'If-None-Match': etag! }, cache: 'no-cache' });
      assert.equal(same.status, 304);

      assert.equal((await fetch(path.replace(/\/media\/([^/]+)\/[^/]+\//, '/media/$1/wrong-token/'))).status, 404);
    });

    it('refuses to delete a file still used by a playlist', async () => {
      const content = Buffer.alloc(10, 1);
      const uploadId = await uploadInParts(admin, server.base, 'dang-dung.png', content, 'media');
      const asset = await admin.json('POST', `/api/admin/media/finish/${uploadId}`, {});
      await admin.json('PUT', `/api/admin/signage/playlists/${playlistId}/items`, { items: [{ kind: 'image', mediaAssetId: asset.id }] });
      const refused = await admin.request('DELETE', `/api/admin/media/${asset.id}`);
      assert.equal(refused.status, 400);
    });

    it('serves the YouTube page in a shape the player can frame', async () => {
      const page = await fetch(`${server.base}/player/youtube/?v=dQw4w9WgXcQ&mute=1`);
      assert.equal(page.status, 200);
      assert.equal(page.headers.get('x-frame-options'), null);
      const csp = page.headers.get('content-security-policy') ?? '';
      assert.ok(!csp.includes('frame-ancestors'));
      const html = await page.text();
      assert.ok(html.includes('onStateChange'));
      assert.ok(html.includes('onError'));
      assert.ok(html.includes('postMessage'));
    });
  });

  describe('leaving', () => {
    it('removes a tablet that unenrolls itself', async () => {
      const tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token);
      const response = await fetch(`${server.base}/api/v1/devices/${tablet.deviceId}/unenroll/`, { method: 'POST', headers: tablet.auth() });
      assert.equal(response.status, 200);
      assert.equal((await tablet.heartbeat()).status, 401);
      // Kept for its history until someone deletes it, and out of reach of any command
      const device = await admin.json('GET', `/api/admin/devices/${tablet.deviceId}`);
      assert.ok(device.unenrolledAt);
      assert.equal(device.online, false);
      const sent = await admin.json('POST', '/api/admin/commands', { type: 'reload', target: { deviceIds: [tablet.deviceId] } });
      assert.equal(sent.sent, 0);
      await admin.json('DELETE', `/api/admin/devices/${tablet.deviceId}`);
      assert.equal(await server.prisma.device.count({ where: { id: tablet.deviceId } }), 0);
    });

    it('tells a tablet to leave at its next heartbeat', async () => {
      const tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token);
      await admin.json('POST', `/api/admin/devices/${tablet.deviceId}/unenroll`);
      const { data } = await tablet.heartbeat();
      assert.equal(data.force_unenroll, true);
      assert.equal((await tablet.heartbeat()).status, 401);
      assert.ok((await admin.json('GET', `/api/admin/devices/${tablet.deviceId}`)).unenrolledAt);
    });
  });

  describe('the APK channel and QR provisioning', () => {
    it('delivers an install to the updates channel, not the commands one, with an authenticated download', async () => {
      const tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token, ['silent_install']);
      const apk = await server.prisma.apkPackage.create({
        data: { fileName: 'ung-dung.apk', storageKey: 'apk/test.apk', sizeBytes: 3, sha256Hex: 'ab', checksumBase64: 'q6s', packageName: 'com.example.app', versionName: '1.2.3' },
      });
      const { writeFile } = await import('node:fs/promises');
      const { join } = await import('node:path');
      const { env } = await import('../src/config/env');
      await writeFile(join(env().dataDir, 'apk', 'test.apk'), 'apk');

      const result = await admin.json('POST', `/api/admin/apks/${apk.id}/deploy`, { target: { deviceIds: [tablet.deviceId] } });
      assert.equal(result.sent, 1);
      assert.equal((await tablet.heartbeat()).data.pending_commands, 1);
      assert.equal(((await (await tablet.get('commands')).json()) as any).commands.length, 0);

      const updates: any = await (await tablet.get('updates')).json();
      assert.equal(updates.length, 1);
      assert.equal(updates[0].package_name, 'com.example.app');
      assert.equal(updates[0].version_name, '1.2.3');
      assert.ok(updates[0].command_id);

      const path = new URL(updates[0].download_url).pathname;
      assert.equal((await fetch(`${server.base}${path}`)).status, 401);
      const download = await fetch(`${server.base}${path}`, { headers: tablet.auth() });
      assert.equal(download.status, 200);
      assert.equal(await download.text(), 'apk');
    });

    it('skips a tablet that is not Device Owner', async () => {
      const tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token, ['screen']);
      const apk = await server.prisma.apkPackage.findFirstOrThrow();
      const result = await admin.json('POST', `/api/admin/apks/${apk.id}/deploy`, { target: { deviceIds: [tablet.deviceId] } });
      assert.equal(result.sent, 0);
      assert.equal(result.skipped.length, 1);
    });

    it('builds the provisioning QR the Android setup wizard and DeviceAdminReceiver expect', async () => {
      const { id, token } = await newToken(admin);
      let qr = await admin.json('GET', `/api/admin/enrollment/tokens/${id}/qr`);
      assert.equal(qr.provisioning, null);
      assert.deepEqual(JSON.parse(qr.app), { url: 'https://kiosk.test.local', token });
      assert.ok(qr.adb.includes(`--es cloud_token "${token}"`));
      assert.ok(qr.adb.includes('--es cloud_url "https://kiosk.test.local"'));

      const own = await server.prisma.apkPackage.create({
        data: { fileName: 'FreeKiosk.apk', storageKey: 'apk/test.apk', sizeBytes: 3, sha256Hex: 'ab', checksumBase64: 'q6s', packageName: 'com.freekiosk', versionName: '2.1.0' },
      });
      const other = await server.prisma.apkPackage.findFirstOrThrow({ where: { packageName: 'com.example.app' } });
      assert.equal((await admin.request('POST', `/api/admin/apks/${other.id}/provisioning`)).status, 400);
      await admin.json('POST', `/api/admin/apks/${own.id}/provisioning`);

      qr = await admin.json('GET', `/api/admin/enrollment/tokens/${id}/qr`);
      const payload = JSON.parse(qr.provisioning);
      assert.equal(payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME'], 'com.freekiosk/.DeviceAdminReceiver');
      assert.equal(payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION'], 'https://kiosk.test.local/dpc-apk-download/');
      assert.equal(payload['android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_CHECKSUM'], 'q6s');
      const extras = payload['android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE'];
      assert.equal(extras.enroll_token, token);
      assert.equal(extras.cloud_url, 'https://kiosk.test.local');
      assert.equal(typeof extras.org_id, 'string');

      // The setup wizard has no account
      const download = await fetch(`${server.base}/dpc-apk-download/`);
      assert.equal(download.status, 200);
      assert.equal(await download.text(), 'apk');
    });

    it('refuses an upload that is not a real APK', async () => {
      const uploadId = await uploadInParts(admin, server.base, 'gia.apk', Buffer.from('this is not a zip file at all'), 'apk');
      const response = await admin.request('POST', `/api/admin/apks/finish/${uploadId}`, {});
      assert.equal(response.status, 400);
    });
  });
});
