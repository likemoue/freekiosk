import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { resetRateLimits } from '../src/common/rate-limit';
import { AdminClient, adminClient, FakeTablet, newToken, startServer, TestServer } from './helpers';

/**
 * The screen timeout in a profile (display.screenOffTimeout). Android keeps it, not the app's settings: an
 * app from 2.1.0-beta.21 takes it from its config and says so (screen_timeout_config), an older one is sent
 * the command it already runs, or a profile would show as applied with the screen never going off.
 */
describe('the screen timeout in a profile', () => {
  let server: TestServer;
  let admin: AdminClient;
  let n = 0;

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
  const commandsOf = (tablet: FakeTablet) =>
    server.prisma.command.findMany({ where: { deviceId: tablet.deviceId, type: 'set_screen_timeout' } });
  const applyTo = async (tablets: FakeTablet[], config: Record<string, unknown>) => {
    const profile = await admin.json('POST', '/api/admin/profiles', { name: `Hồ sơ ${++n}`, config });
    for (const tablet of tablets) await admin.json('PATCH', `/api/admin/devices/${tablet.deviceId}`, { profileId: profile.id });
  };

  it('reaches an older app as the command, and a newer one through its config alone', async () => {
    const older = await enrolled(['screen', 'screen_timeout']);
    const newer = await enrolled(['screen', 'screen_timeout', 'screen_timeout_config']);
    await applyTo([older, newer], { display: { keepScreenOn: false, screenOffTimeout: 30 } });

    const [command, ...more] = await commandsOf(older);
    assert.equal(more.length, 0);
    assert.deepEqual(command.params, { seconds: '30' });
    assert.equal(command.status, 'PENDING');
    assert.equal(command.source, 'config');
    assert.deepEqual(await commandsOf(newer), []);
    assert.equal(((await server.prisma.device.findUniqueOrThrow({ where: { id: newer.deviceId } })).pendingConfig as any).display.screenOffTimeout, 30);
  });

  it('sends nothing for a profile without it, a value the command would refuse, or an app without the command', async () => {
    const older = await enrolled(['screen', 'screen_timeout']);
    const oldest = await enrolled(['screen']);
    await applyTo([older, oldest], { display: { keepScreenOn: false } });
    await applyTo([older, oldest], { display: { screenOffTimeout: 5 } });
    await applyTo([oldest], { display: { screenOffTimeout: 60 } });
    assert.deepEqual(await commandsOf(older), []);
    assert.deepEqual(await commandsOf(oldest), []);
  });

  it('takes never, as the command writes it', async () => {
    const older = await enrolled(['screen', 'screen_timeout']);
    await applyTo([older], { display: { screenOffTimeout: -1 } });
    assert.deepEqual((await commandsOf(older)).map((c) => c.params), [{ seconds: '-1' }]);
  });
});
