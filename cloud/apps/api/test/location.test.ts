import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { resetRateLimits } from '../src/common/rate-limit';
import { AdminClient, adminClient, FakeTablet, newToken, startServer, TestServer } from './helpers';

const HANOI = { latitude: 21.028511, longitude: 105.804817 };

describe('the map', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());
  beforeEach(() => admin.json('PATCH', '/api/admin/locations/settings', { enabled: true }));

  const enrolled = async (capabilities = ['screen', 'locate']) => {
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin)).token, capabilities);
    return tablet;
  };
  const rowOf = async (tablet: FakeTablet) => (await admin.json<any[]>('GET', '/api/admin/devices')).find((d) => d.id === tablet.deviceId);
  const fix = (extra: Record<string, unknown> = {}) => ({ location: { state: 'ok', ...HANOI, accuracy_m: 32.4, age_ms: 5_000, provider: 'fused', ...extra } });

  it('asks every tablet for its place, and keeps the one it sends', async () => {
    const tablet = await enrolled();
    const { data } = await tablet.heartbeat(fix());
    assert.equal(data.location_wanted, true);

    const row = await rowOf(tablet);
    assert.equal(row.locationState, 'ok');
    assert.equal(row.location.latitude, HANOI.latitude);
    assert.equal(row.location.longitude, HANOI.longitude);
    assert.equal(row.location.accuracyM, 32.4);
    assert.equal(row.location.provider, 'fused');
    // Dated by the server's clock from the age, not by the tablet's clock
    const age = Date.now() - new Date(row.location.at).getTime();
    assert.ok(age >= 5_000 && age < 15_000, `age ${age}`);
  });

  it('keeps the place when the tablet only says why it has no new one', async () => {
    const tablet = await enrolled();
    await tablet.heartbeat(fix());
    await tablet.heartbeat({ location: { state: 'no_fix' } });
    const row = await rowOf(tablet);
    assert.equal(row.locationState, 'no_fix');
    assert.equal(row.location.latitude, HANOI.latitude);
  });

  it('does not go back to an older fix than the one kept', async () => {
    const tablet = await enrolled();
    await tablet.heartbeat(fix({ age_ms: 1_000 }));
    await tablet.heartbeat(fix({ latitude: 10.776, longitude: 106.7, age_ms: 3_600_000 }));
    assert.equal((await rowOf(tablet)).location.latitude, HANOI.latitude);
  });

  it('refuses a place that cannot be one', async () => {
    const tablet = await enrolled();
    await tablet.heartbeat(fix({ latitude: 0, longitude: 0 }));
    const row = await rowOf(tablet);
    assert.equal(row.location, null);
    assert.equal(row.locationState, 'error');
  });

  it('has no place for an older app, which says nothing of it', async () => {
    const tablet = await enrolled(['screen']);
    await tablet.heartbeat();
    const row = await rowOf(tablet);
    assert.equal(row.location, null);
    assert.equal(row.locationState, null);
  });

  describe('switched off', () => {
    it('forgets every place, stops asking, and takes none', async () => {
      const tablet = await enrolled();
      await tablet.heartbeat(fix());
      await admin.json('PATCH', '/api/admin/locations/settings', { enabled: false });

      assert.equal((await rowOf(tablet)).location, null);
      const { data } = await tablet.heartbeat(fix());
      assert.equal(data.location_wanted, false);
      assert.equal((await rowOf(tablet)).location, null);

      const entry = await server.prisma.activityLog.findFirst({ where: { action: 'location.disabled' }, orderBy: { createdAt: 'desc' } });
      assert.ok(entry?.message.includes('admin@test.local'));
    });

    it('sends no tablet the command that would turn location on', async () => {
      const tablet = await enrolled();
      await admin.json('PATCH', '/api/admin/locations/settings', { enabled: false });
      const response = await admin.request('POST', '/api/admin/commands', { type: 'locate', target: { deviceIds: [tablet.deviceId] } });
      assert.equal(response.status, 400);
    });
  });

  describe('the command that asks for a place now', () => {
    const queue = async (tablet: FakeTablet) => {
      const result = await admin.json('POST', '/api/admin/commands', { type: 'locate', target: { deviceIds: [tablet.deviceId] } });
      assert.equal(result.sent, 1);
      const [command] = ((await (await tablet.get('commands')).json()) as any).commands;
      assert.equal(command.type, 'locate');
      return command.id as string;
    };
    const lineOf = async (tablet: FakeTablet) => (await admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`))[0];

    it('puts the tablet on the map with what it found', async () => {
      const tablet = await enrolled();
      const id = await queue(tablet);
      await tablet.sendResult(id, 'success', fix());
      assert.equal((await lineOf(tablet)).status, 'SUCCESS');
      assert.equal((await rowOf(tablet)).location.latitude, HANOI.latitude);
    });

    it('says in words why the tablet found nothing', async () => {
      const tablet = await enrolled();
      const id = await queue(tablet);
      await tablet.sendResult(id, 'success', { location: { state: 'disabled' } });
      const line = await lineOf(tablet);
      assert.equal(line.status, 'ERROR');
      assert.match(line.errorMessage, /Dịch vụ vị trí đang tắt/);
      assert.equal((await rowOf(tablet)).locationState, 'disabled');
    });

    it('skips a tablet whose app cannot', async () => {
      const tablet = await enrolled(['screen']);
      const result = await admin.json('POST', '/api/admin/commands', { type: 'locate', target: { deviceIds: [tablet.deviceId] } });
      assert.equal(result.sent, 0);
      assert.equal(result.skipped[0].reason, 'Cần FreeKiosk bản mới nhất');
    });
  });

  it('lets only an administrator switch it', async () => {
    const { temporaryPassword } = await admin.json('POST', '/api/admin/users', { email: 'ban-do@test.local', name: 'Vận hành', role: 'OPERATOR' });
    const operator = new AdminClient(server.base);
    await operator.login('ban-do@test.local', temporaryPassword);
    await operator.json('POST', '/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: 'Mat-khau-van-hanh-12345' });
    assert.equal((await operator.request('PATCH', '/api/admin/locations/settings', { enabled: false })).status, 403);
    assert.equal((await operator.json('GET', '/api/admin/locations/settings')).enabled, true);
  });
});
