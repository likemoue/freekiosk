import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { resetRateLimits } from '../src/common/rate-limit';
import { AdminClient, adminClient, FakeTablet, newToken, startServer, TestServer } from './helpers';

describe('commands that are really a change of settings', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  const enrolled = async (token: Record<string, unknown> = {}) => {
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin, token)).token);
    await tablet.heartbeat();
    return tablet;
  };

  const send = (type: string, params: Record<string, unknown>, target: Record<string, unknown>) => admin.json('POST', '/api/admin/commands', { type, params, target });
  const one = (tablet: FakeTablet) => ({ deviceIds: [tablet.deviceId] });
  const historyOf = (tablet: FakeTablet) => admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`);

  it('keeps a line in the history, without giving the tablet a command to run', async () => {
    const tablet = await enrolled();
    const result = await send('set_url', { url: 'https://example.com/moi' }, one(tablet));
    assert.equal(result.sent, 1);

    const [line, ...others] = await historyOf(tablet);
    assert.equal(others.length, 0);
    assert.equal(line.type, 'set_url');
    assert.equal(line.status, 'SENT');
    assert.deepEqual(line.params, { url: 'https://example.com/moi' });
    assert.equal(line.createdBy, 'admin@test.local');
    assert.equal(line.batchId, result.batchId);

    const beat = await tablet.heartbeat();
    assert.equal(beat.data.pending_commands, 0);
    assert.equal(beat.data.sync_action, 'apply');
    assert.deepEqual(beat.data.config, { general: { url: 'https://example.com/moi' } });
    assert.deepEqual(((await (await tablet.get('commands')).json()) as any).commands, []);
    assert.deepEqual(await (await tablet.get('updates')).json(), []);
  });

  it('shows in the history of the Commands page too, with the name of the device', async () => {
    const tablet = await enrolled();
    const { batchId } = await send('set_brightness', { percent: '40' }, one(tablet));
    const rows = await admin.json<any[]>('GET', '/api/admin/commands');
    const line = rows.find((row) => row.batchId === batchId);
    assert.equal(line.type, 'set_brightness');
    assert.equal(line.device.id, tablet.deviceId);
  });

  it('turns to success once the tablet has confirmed the change', async () => {
    const tablet = await enrolled();
    await send('set_brightness', { percent: '70' }, one(tablet));
    await tablet.heartbeat(); // receives it
    assert.equal((await historyOf(tablet))[0].status, 'SENT');
    await tablet.heartbeat(); // has it
    const [line] = await historyOf(tablet);
    assert.equal(line.status, 'SUCCESS');
    assert.ok(line.completedAt);
  });

  it('does not count a newer change as confirmed by an older one', async () => {
    const tablet = await enrolled();
    await send('set_brightness', { percent: '70' }, one(tablet));
    await tablet.heartbeat(); // receives the first
    await send('set_url', { url: 'https://example.com/sau' }, one(tablet));
    await tablet.heartbeat(); // receives the second, so nothing is confirmed yet
    assert.deepEqual((await historyOf(tablet)).map((line) => line.status), ['SENT', 'SENT']);
    await tablet.heartbeat();
    assert.deepEqual((await historyOf(tablet)).map((line) => line.status), ['SUCCESS', 'SUCCESS']);
  });

  it('survives a tablet that was away past the expiry, once it comes back', async () => {
    const tablet = await enrolled();
    await send('set_url', { url: 'https://example.com/xa' }, one(tablet));
    await server.prisma.command.updateMany({ where: { deviceId: tablet.deviceId }, data: { status: 'EXPIRED' } });
    await tablet.heartbeat();
    await tablet.heartbeat();
    assert.equal((await historyOf(tablet))[0].status, 'SUCCESS');
  });

  it('gives each tablet of a group its own line, and leaves the others alone', async () => {
    const group = await admin.json('POST', '/api/admin/groups', { name: 'Đổi URL cả nhóm' });
    const [a, b, outside] = [await enrolled({ groupId: group.id }), await enrolled({ groupId: group.id }), await enrolled()];

    const result = await send('set_url', { url: 'https://example.com/nhom' }, { groupId: group.id });
    assert.equal(result.sent, 2);
    assert.equal((await historyOf(a)).length, 1);
    assert.equal((await historyOf(b)).length, 1);
    assert.deepEqual(await historyOf(outside), []);
    assert.equal((await outside.heartbeat()).data.sync_action, 'none');
    assert.equal((await a.heartbeat()).data.sync_action, 'apply');
  });

  it('sends the brightness as the fraction the app expects, whether text or a number', async () => {
    const tablet = await enrolled();
    await send('set_brightness', { percent: ' 70 ' }, one(tablet));
    assert.deepEqual((await tablet.heartbeat()).data.config, { display: { brightnessManagement: true, defaultBrightness: 0.7 } });
    await tablet.heartbeat();

    await send('set_brightness', { percent: 0 }, one(tablet));
    assert.deepEqual((await tablet.heartbeat()).data.config, { display: { brightnessManagement: true, defaultBrightness: 0 } });
  });

  it('refuses what cannot be right, and then nothing reaches the tablet', async () => {
    const tablet = await enrolled();
    const refused = async (type: string, params: Record<string, unknown>, target: Record<string, unknown> = one(tablet)) => {
      const response = await admin.request('POST', '/api/admin/commands', { type, params, target });
      assert.equal(response.status, 400, `${type} ${JSON.stringify(params)}`);
    };
    await refused('set_url', {});
    await refused('set_url', { url: 'ftp://example.com/' });
    await refused('set_url', { url: 'https://co khoang trang' });
    await refused('set_brightness', {});
    await refused('set_brightness', { percent: '' });
    await refused('set_brightness', { percent: 'sáng' });
    await refused('set_brightness', { percent: '101' });
    await refused('set_brightness', { percent: -1 });
    await refused('set_url', { url: 'https://example.com/' }, {});

    assert.deepEqual(await historyOf(tablet), []);
    assert.equal((await tablet.heartbeat()).data.sync_action, 'none');
  });

  it('is for administrators and operators, and leaves a trace', async () => {
    const { temporaryPassword } = await admin.json('POST', '/api/admin/users', { email: 'xem-lenh@test.local', name: 'Xem', role: 'VIEWER' });
    const viewer = new AdminClient(server.base);
    await viewer.login('xem-lenh@test.local', temporaryPassword);
    await viewer.request('POST', '/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: 'Xem-Lenh-Mat-Khau-9' });

    const tablet = await enrolled();
    const body = { type: 'set_url', params: { url: 'https://example.com/' }, target: one(tablet) };
    assert.equal((await viewer.request('POST', '/api/admin/commands', body)).status, 403);
    assert.deepEqual(await historyOf(tablet), []);

    await send('set_url', { url: 'https://example.com/' }, one(tablet));
    const log = await server.prisma.activityLog.findFirstOrThrow({ where: { action: 'command.queued', deviceId: tablet.deviceId } });
    assert.match(log.message, /gửi lệnh "Đổi URL hiển thị" tới/);
  });

  it('cannot be scheduled, as a change of settings would pile up with nobody watching', async () => {
    const task = { name: 'Mỗi ngày', targetType: 'all', days: [1, 2, 3, 4, 5, 6, 7], time: '06:30' };
    const refused = await admin.request('POST', '/api/admin/scheduler/tasks', { ...task, commandType: 'set_url', params: { url: 'https://example.com/' } });
    assert.equal(refused.status, 400);
    assert.match(await refused.text(), /Lệnh không được hỗ trợ/);
    // The same request is fine with a command a tablet can run, so it is the type that was refused
    await admin.json('POST', '/api/admin/scheduler/tasks', { ...task, commandType: 'reload' });
  });
});
