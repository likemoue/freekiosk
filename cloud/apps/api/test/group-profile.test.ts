import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { resetRateLimits } from '../src/common/rate-limit';
import { AdminClient, adminClient, FakeTablet, newToken, startServer, TestServer } from './helpers';

/**
 * A group's profile reaches the tablets of the group. On 11 November 44 of the 45 tablets of HTP - CS1 held
 * the group's profile as their own, copied from the enrollment code, so a new profile on the group reached
 * one tablet; deleting the old profile then left the 44 on the group's new one without sending it.
 */
describe("a group's profile", () => {
  let server: TestServer;
  let admin: AdminClient;
  let n = 0;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  const profile = (config: Record<string, unknown>) => admin.json('POST', '/api/admin/profiles', { name: `Hồ sơ ${++n}`, config });
  const group = (profileId: string) => admin.json('POST', '/api/admin/groups', { name: `Nhóm ${++n}`, profileId });
  const enrolled = async (body: Record<string, unknown>) => {
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin, body)).token);
    return tablet;
  };
  const deviceOf = (tablet: FakeTablet) => server.prisma.device.findUniqueOrThrow({ where: { id: tablet.deviceId } });
  const sentProfiles = async (tablet: FakeTablet) =>
    (await admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`))
      .filter((line) => line.type === 'apply_profile')
      .map((line) => line.params.profile);

  it('comes with an enrollment code naming it, and the tablet follows the group from then on', async () => {
    const old = await profile({ general: { autoReload: false } });
    const fresh = await profile({ general: { autoReload: true } });
    const g = await group(old.id);
    const tablet = await enrolled({ groupId: g.id, profileId: old.id });
    assert.equal((await deviceOf(tablet)).profileId, null);

    const saved = await admin.json('PATCH', `/api/admin/groups/${g.id}`, { profileId: fresh.id });
    assert.equal(saved.appliedTo, 1);
    assert.equal(saved.keptOwn, 0);
    assert.deepEqual(await sentProfiles(tablet), [fresh.name]);
    assert.equal(((await deviceOf(tablet)).pendingConfig as any).general.autoReload, true);
  });

  it('reaches a tablet that held the old one as its own, as enrolled before this was fixed', async () => {
    const old = await profile({ general: { autoReload: false } });
    const fresh = await profile({ general: { autoReload: true } });
    const g = await group(old.id);
    const tablet = await enrolled({ groupId: g.id });
    await server.prisma.device.update({ where: { id: tablet.deviceId }, data: { profileId: old.id } });

    const saved = await admin.json('PATCH', `/api/admin/groups/${g.id}`, { profileId: fresh.id });
    assert.equal(saved.appliedTo, 1);
    assert.equal((await deviceOf(tablet)).profileId, null);
    assert.deepEqual(await sentProfiles(tablet), [fresh.name]);
  });

  it('leaves a tablet given another profile of its own, and says how many', async () => {
    const old = await profile({ general: { autoReload: false } });
    const fresh = await profile({ general: { autoReload: true } });
    const own = await profile({ security: { returnMode: 'button' } });
    const g = await group(old.id);
    const tablet = await enrolled({ groupId: g.id, profileId: own.id });
    assert.equal((await deviceOf(tablet)).profileId, own.id);

    const saved = await admin.json('PATCH', `/api/admin/groups/${g.id}`, { profileId: fresh.id });
    assert.equal(saved.appliedTo, 0);
    assert.equal(saved.keptOwn, 1);
    assert.equal((await deviceOf(tablet)).profileId, own.id);
    assert.deepEqual(await sentProfiles(tablet), []);
  });

  it("is sent to a tablet whose own profile is deleted", async () => {
    const groupProfile = await profile({ general: { autoReload: true } });
    const own = await profile({ general: { autoReload: false } });
    const g = await group(groupProfile.id);
    const tablet = await enrolled({ groupId: g.id, profileId: own.id });

    const deleted = await admin.json('DELETE', `/api/admin/profiles/${own.id}`);
    assert.equal(deleted.appliedTo, 1);
    assert.equal((await deviceOf(tablet)).profileId, null);
    assert.deepEqual(await sentProfiles(tablet), [groupProfile.name]);
    assert.equal(((await deviceOf(tablet)).pendingConfig as any).general.autoReload, true);
  });
});
