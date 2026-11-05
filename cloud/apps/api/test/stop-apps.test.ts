import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { resetRateLimits } from '../src/common/rate-limit';
import { SchedulerService } from '../src/scheduler/scheduler.controller';
import { AdminClient, adminClient, FakeTablet, newToken, startServer, TestServer } from './helpers';

describe('stopping every app', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  const enrolled = async (capabilities: string[], token: Record<string, unknown> = {}) => {
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin, token)).token, capabilities);
    return tablet;
  };
  const send = (target: Record<string, unknown>) => admin.json('POST', '/api/admin/commands', { type: 'stop_apps', target });

  it('reaches a tablet that can, which then says what it stopped', async () => {
    const tablet = await enrolled(['stop_apps']);
    const result = await send({ deviceIds: [tablet.deviceId] });
    assert.equal(result.sent, 1);

    const { commands } = (await (await tablet.get('commands')).json()) as any;
    assert.equal(commands[0].type, 'stop_apps');
    await tablet.sendResult(commands[0].id, 'success', { stopped: ['vn.iclass', 'vn.chrome'] });

    const [line] = await admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`);
    assert.equal(line.status, 'SUCCESS');
    assert.deepEqual(line.result, { stopped: ['vn.iclass', 'vn.chrome'] });
  });

  it('skips a tablet that cannot, saying what that tablet needs', async () => {
    const tablet = await enrolled(['screen', 'reload']);
    const result = await send({ deviceIds: [tablet.deviceId] });
    assert.equal(result.sent, 0);
    assert.match(result.skipped[0].reason, /bản mới nhất/);
    assert.deepEqual(((await (await tablet.get('commands')).json()) as any).commands, []);
  });

  it('sends the rest of a group on, and names the ones it skipped', async () => {
    const group = await admin.json('POST', '/api/admin/groups', { name: 'Lớp 40 tablet' });
    await enrolled(['stop_apps'], { groupId: group.id });
    await enrolled(['stop_apps'], { groupId: group.id });
    await enrolled(['screen'], { groupId: group.id });

    const result = await send({ groupId: group.id });
    assert.equal(result.sent, 2);
    assert.equal(result.skipped.length, 1);
  });

  it('can be scheduled for the end of the day', async () => {
    const tablet = await enrolled(['stop_apps']);
    const task = await admin.json('POST', '/api/admin/scheduler/tasks', {
      name: 'Dừng ứng dụng cuối ngày',
      commandType: 'stop_apps',
      targetType: 'devices',
      deviceIds: [tablet.deviceId],
      days: [1, 2, 3, 4, 5],
      time: '17:00',
    });
    assert.ok(task.nextRunAt);
  });
});

describe('what is a command', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  // Each of these is a key of every object in JavaScript, and "constructor" as a command reached
  // the tablet's action layer: an operator could run what only an administrator may
  for (const type of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    it(`does not take ${type}`, async () => {
      resetRateLimits();
      const tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token);
      const body = { type, params: { command: 'executeJs', params: { code: 'x' } }, target: { deviceIds: [tablet.deviceId] } };
      assert.equal((await admin.request('POST', '/api/admin/commands', body)).status, 400);
      assert.deepEqual(((await (await tablet.get('commands')).json()) as any).commands, []);

      const task = { name: 'Lịch', commandType: type, targetType: 'all', days: [1], time: '06:30' };
      assert.equal((await admin.request('POST', '/api/admin/scheduler/tasks', task)).status, 400);
    });
  }

  it('leaves a line for a tablet it skipped, saying why', async () => {
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin)).token, ['screen']);
    await admin.json('POST', '/api/admin/commands', { type: 'stop_apps', target: { deviceIds: [tablet.deviceId] } });

    const [line] = await admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`);
    assert.equal(line.type, 'stop_apps');
    assert.equal(line.status, 'ERROR');
    assert.match(line.errorMessage, /bản mới nhất/);
    assert.ok(line.completedAt);
    const log = await server.prisma.activityLog.findFirstOrThrow({ where: { action: 'command.queued' }, orderBy: { createdAt: 'desc' } });
    assert.match(log.message, /bỏ qua 1 thiết bị/);
  });

  it('hands back only as many lines as asked for, newest first', async () => {
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin)).token, ['screen']);
    for (let i = 0; i < 3; i++) await admin.json('POST', '/api/admin/commands', { type: 'wake', target: { deviceIds: [tablet.deviceId] } });

    assert.equal((await admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`)).length, 3);
    assert.equal((await admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}&take=2`)).length, 2);
    assert.equal((await admin.request('GET', '/api/admin/commands?take=abc')).status, 400);
  });
});

describe('a schedule the server was down for', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  const scheduled = async () => {
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin)).token, ['stop_apps']);
    const task = await admin.json('POST', '/api/admin/scheduler/tasks', {
      name: 'Dừng ứng dụng cuối ngày',
      commandType: 'stop_apps',
      targetType: 'devices',
      deviceIds: [tablet.deviceId],
      days: [1, 2, 3, 4, 5, 6, 7],
      time: '17:00',
    });
    return { tablet, task, at: new Date(task.nextRunAt).getTime() };
  };
  const minutes = (count: number) => count * 60_000;

  it('still runs when it is a little late', async () => {
    const { tablet, at } = await scheduled();
    await server.app.get(SchedulerService).runDue(new Date(at + minutes(10)));
    assert.equal((await admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`)).length, 1);
  });

  it('does not run hours later, in the middle of the next lesson', async () => {
    const { tablet, task, at } = await scheduled();
    const morning = new Date(at + minutes(15 * 60));
    await server.app.get(SchedulerService).runDue(morning);

    assert.deepEqual(await admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`), []);
    const row = await server.prisma.scheduledTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.ok(row.nextRunAt! > morning, 'it waits for its next time');
    assert.equal(row.lastRunAt, null);
    const log = await server.prisma.activityLog.findFirstOrThrow({ where: { action: 'schedule.task_missed' } });
    assert.equal(log.severity, 'warning');
  });
});

describe('the screen timeout', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  const enrolled = async (capabilities: string[]) => {
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin)).token, capabilities);
    return tablet;
  };
  const send = (tablet: FakeTablet, params: Record<string, unknown>) =>
    admin.request('POST', '/api/admin/commands', { type: 'set_screen_timeout', params, target: { deviceIds: [tablet.deviceId] } });

  it('reaches a tablet with what was chosen, and keeps a line in the history', async () => {
    const tablet = await enrolled(['screen_timeout']);
    assert.equal((await send(tablet, { seconds: '600' })).status, 201);

    const { commands } = (await (await tablet.get('commands')).json()) as any;
    assert.equal(commands[0].type, 'set_screen_timeout');
    assert.deepEqual(commands[0].params, { seconds: '600' });
    await tablet.sendResult(commands[0].id, 'success', { seconds: 600 });

    const [line] = await admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`);
    assert.equal(line.status, 'SUCCESS');
  });

  it('takes never', async () => {
    const tablet = await enrolled(['screen_timeout']);
    assert.equal((await send(tablet, { seconds: -1 })).status, 201);
  });

  it('refuses what is not a time', async () => {
    const tablet = await enrolled(['screen_timeout']);
    for (const seconds of [undefined, '', 'lâu', 0, 5, -2, 100_000, 1.5]) {
      assert.equal((await send(tablet, { seconds })).status, 400, String(seconds));
    }
  });

  it('skips a tablet of an older version, saying so', async () => {
    const tablet = await enrolled(['screen']);
    const result: any = await (await send(tablet, { seconds: 60 })).json();
    assert.equal(result.sent, 0);
    assert.match(result.skipped[0].reason, /bản mới nhất/);
  });
});

describe('the list of devices', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  it('reads in the order of the names, with numbers counted as numbers', async () => {
    for (const name of ['Tablet 10', 'Tablet 2', 'máy ảnh', 'tablet 1']) {
      resetRateLimits();
      const tablet = new FakeTablet(server.base);
      await tablet.enroll((await newToken(admin)).token);
      await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}`, { name });
    }
    const devices = await admin.json<any[]>('GET', '/api/admin/devices');
    assert.deepEqual(devices.map((device) => device.name), ['máy ảnh', 'tablet 1', 'Tablet 2', 'Tablet 10']);
  });
});
