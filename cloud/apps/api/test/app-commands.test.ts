import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { resetRateLimits } from '../src/common/rate-limit';
import { AdminClient, adminClient, FakeTablet, newToken, startServer, TestServer } from './helpers';

describe('commands about apps', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  const enrolled = async (capabilities = ['screen', 'clear_app_data']) => {
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin)).token, capabilities);
    return tablet;
  };
  const clear = (tablet: FakeTablet, params: Record<string, unknown>) =>
    admin.request('POST', '/api/admin/commands', { type: 'clear_app_data', params, target: { deviceIds: [tablet.deviceId] } });
  const take = async (tablet: FakeTablet) => ((await (await tablet.get('commands')).json()) as any).commands;
  const historyOf = (tablet: FakeTablet) => admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`);

  describe('clearing the data of apps', () => {
    it('hands the tablet the apps chosen, and keeps what it answers', async () => {
      const tablet = await enrolled();
      const response = await clear(tablet, { packages: ['vn.iclass', 'vn.ipro'], labels: ['iCLASS', 'iSMART Pro'] });
      assert.equal(response.status, 201);
      const [command] = await take(tablet);
      assert.equal(command.type, 'clear_app_data');
      assert.deepEqual(command.params.packages, ['vn.iclass', 'vn.ipro']);
      await tablet.sendResult(command.id, 'success', { cleared: ['vn.iclass'], missing: ['vn.ipro'], failed: [], permissionsLost: [] });
      const [line] = await historyOf(tablet);
      assert.equal(line.status, 'SUCCESS');
      assert.deepEqual(line.result.missing, ['vn.ipro']);
      assert.deepEqual(line.params.labels, ['iCLASS', 'iSMART Pro']);
    });

    it('refuses no apps, what is not a package, and FreeKiosk itself', async () => {
      const tablet = await enrolled();
      for (const packages of [undefined, [], 'vn.iclass', ['not a package'], ['vn.iclass', 7], ['com.freekiosk']]) {
        assert.equal((await clear(tablet, { packages })).status, 400, JSON.stringify(packages));
      }
      assert.deepEqual(await take(tablet), []);
    });

    it('says why it skipped a tablet that cannot', async () => {
      const tablet = await enrolled(['screen']);
      await clear(tablet, { packages: ['vn.iclass'] });
      assert.deepEqual(await take(tablet), []);
      const [line] = await historyOf(tablet);
      assert.equal(line.status, 'ERROR');
      assert.match(line.errorMessage, /bản mới nhất/);
    });

    it('tries a tablet that reports no capabilities at all, an older app', async () => {
      const tablet = await enrolled([]);
      await clear(tablet, { packages: ['vn.iclass'] });
      // An empty list is an older app: it is tried, and it answers that it does not know the command
      const [command] = await take(tablet);
      assert.equal(command.type, 'clear_app_data');
    });
  });

  it('opens an app by its package, and keeps the name for the history', async () => {
    const tablet = await enrolled();
    await admin.json('POST', '/api/admin/commands', { type: 'launch_app', params: { package_name: 'vn.iclass', label: 'iCLASS' }, target: { deviceIds: [tablet.deviceId] } });
    const [command] = await take(tablet);
    assert.equal(command.params.package_name, 'vn.iclass');
    assert.equal((await historyOf(tablet))[0].params.label, 'iCLASS');
  });

  describe('a command a tablet called interrupted while it was still running', () => {
    const INTERRUPTED = 'Device restarted before the command result could be reported';
    const installLine = async (tablet: FakeTablet) =>
      server.prisma.command.create({
        data: {
          deviceId: tablet.deviceId,
          type: 'install_apk',
          params: { package_name: 'vn.ipro', label: 'iSMART Pro', show_on_home: true },
          status: 'SENT',
          sentAt: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

    it('takes the success that follows, with what comes after an install', async () => {
      const tablet = await enrolled();
      const command = await installLine(tablet);
      await tablet.sendResult(command.id, 'error', null, INTERRUPTED);
      assert.equal((await historyOf(tablet))[0].status, 'ERROR');

      await tablet.sendResult(command.id, 'success', { installed_package: 'vn.ipro' });
      const [line] = (await historyOf(tablet)).filter((row) => row.type === 'install_apk');
      assert.equal(line.status, 'SUCCESS');
      assert.equal(line.errorMessage, null);
      const device = await server.prisma.device.findUniqueOrThrow({ where: { id: tablet.deviceId } });
      assert.ok(JSON.stringify(device.pendingConfig).includes('vn.ipro'));
    });

    it('does not take another failure for it, nor change any other answer', async () => {
      const tablet = await enrolled();
      const failed = await installLine(tablet);
      await tablet.sendResult(failed.id, 'error', null, 'Install failed');
      await tablet.sendResult(failed.id, 'success', {});
      assert.equal((await server.prisma.command.findUniqueOrThrow({ where: { id: failed.id } })).status, 'ERROR');

      const interrupted = await installLine(tablet);
      await tablet.sendResult(interrupted.id, 'error', null, INTERRUPTED);
      await tablet.sendResult(interrupted.id, 'error', null, 'Install failed');
      assert.equal((await server.prisma.command.findUniqueOrThrow({ where: { id: interrupted.id } })).errorMessage, INTERRUPTED);

      const done = await installLine(tablet);
      await tablet.sendResult(done.id, 'success', {});
      await tablet.sendResult(done.id, 'error', null, INTERRUPTED);
      assert.equal((await server.prisma.command.findUniqueOrThrow({ where: { id: done.id } })).status, 'SUCCESS');
    });
  });
});
