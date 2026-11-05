import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resetRateLimits } from '../src/common/rate-limit';
import { fleetVersions, FleetDevice, LibraryApk } from '../src/devices/fleet-versions';
import { configDifferences, profileStatus } from '../src/devices/profile-state';
import { readVideoDurationMs } from '../src/files/media-duration';
import { AdminClient, adminClient, FakeTablet, newToken, startServer, TestServer, uploadInParts } from './helpers';

const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};
const mvhd = (timescale: number, duration: number) => {
  const content = Buffer.alloc(100);
  content.writeUInt32BE(timescale, 12);
  content.writeUInt32BE(duration, 16);
  return box('mvhd', content);
};
const mp4 = (timescale: number, duration: number) =>
  Buffer.concat([box('ftyp', Buffer.from('isom0000isom', 'latin1')), box('mdat', Buffer.alloc(64)), box('moov', mvhd(timescale, duration))]);
const webm = (milliseconds: number) => {
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE(milliseconds);
  const info = Buffer.concat([
    Buffer.from([0x2a, 0xd7, 0xb1, 0x83, 0x0f, 0x42, 0x40]),
    Buffer.from([0x44, 0x89, 0x88]),
    duration,
  ]);
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x80]),
    Buffer.from([0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
    Buffer.from([0x15, 0x49, 0xa9, 0x66, 0x80 | info.length]),
    info,
  ]);
};

describe('how long a video is', () => {
  let folder = '';
  const lengthOf = (content: Buffer) => {
    const file = join(folder, `video-${Math.random()}`);
    writeFileSync(file, content);
    return readVideoDurationMs(file);
  };
  before(async () => {
    folder = await mkdtemp(join(tmpdir(), 'duration-'));
  });
  after(() => rm(folder, { recursive: true, force: true }));

  it('reads an MP4, with the header after the data as well as before it', async () => {
    assert.equal(await lengthOf(mp4(600, 7400)), 12333);
    assert.equal(await lengthOf(Buffer.concat([box('ftyp', Buffer.alloc(8)), box('moov', mvhd(1000, 90500)), box('mdat', Buffer.alloc(32))])), 90500);
  });

  it('reads a WebM', async () => {
    assert.equal(await lengthOf(webm(12345)), 12345);
  });

  it('says it does not know rather than guess', async () => {
    assert.equal(await lengthOf(Buffer.from('this is not a video at all')), null);
    assert.equal(await lengthOf(mp4(600, 0)), null);
    assert.equal(await lengthOf(Buffer.alloc(4)), null);
    assert.equal(await readVideoDurationMs(join(folder, 'missing')).catch(() => 'threw'), 'threw');
  });
});

describe('a device against its profile', () => {
  it('counts only what the profile sets', () => {
    const wanted = { general: { url: 'https://a/', managedApps: [{ packageName: 'x' }, { packageName: 'y' }] }, display: { defaultBrightness: 0.5 } };
    const same = { general: { url: 'https://a/', managedApps: [{ packageName: 'y' }, { packageName: 'x' }], extra: 1 }, display: { defaultBrightness: 0.5000000001 }, security: { pin: 1 } };
    assert.deepEqual(configDifferences(wanted, same), []);
  });

  it('names what differs, deep down too, with both values', () => {
    const differences = configDifferences({ display: { statusBar: { enabled: true } }, general: { url: 'https://a/' } }, { display: { statusBar: { enabled: false } } });
    assert.deepEqual(differences, [
      { path: 'display.statusBar.enabled', wanted: true, reported: false },
      { path: 'general.url', wanted: 'https://a/', reported: null },
    ]);
  });

  it('takes an empty value for no value', () => {
    assert.deepEqual(configDifferences({ general: { url: '' } }, { general: {} }), []);
  });

  const profile = { id: 'p', name: 'Sảnh', config: { general: { url: 'https://a/' } } };
  const other = { id: 'q', name: 'Lớp', config: {} };

  it('says which profile is in effect and how the device stands', () => {
    const base = { reportedConfig: { general: { url: 'https://a/' } }, pendingConfig: null };
    assert.equal(profileStatus({ ...base }).state, 'none');
    assert.deepEqual(profileStatus({ ...base, group: { profile } }), { state: 'match', profile: { id: 'p', name: 'Sảnh' }, source: 'group', groupProfile: null, differences: [] });
    assert.equal(profileStatus({ ...base, profile }).source, 'device');
    assert.equal(profileStatus({ ...base, profile, pendingConfig: { general: {} } }).state, 'pending');
    assert.equal(profileStatus({ profile, reportedConfig: null, pendingConfig: null }).state, 'not_reported');
    assert.deepEqual(profileStatus({ profile, reportedConfig: { general: { url: 'https://b/' } }, pendingConfig: null }).differences, ['general.url']);
  });

  it('says so when a device does not follow the profile of its group', () => {
    const status = profileStatus({ reportedConfig: {}, pendingConfig: null, profile: other, group: { profile } });
    assert.deepEqual(status.groupProfile, { id: 'p', name: 'Sảnh' });
    assert.equal(profileStatus({ reportedConfig: {}, pendingConfig: null, profile, group: { profile } }).groupProfile, null);
  });
});

describe('which tablet has which version', () => {
  const tablet = (name: string, apps: Array<[string, number, string?]>, appVersion = '2.1.0-beta.7', managed: string[] = []): FleetDevice => ({
    id: name,
    name,
    online: true,
    appVersion,
    installedApps: apps.map(([pkg, code, version]) => ({ package: pkg, label: pkg, version_code: code, ...(version ? { version_name: version } : {}) })),
    reportedConfig: { general: { managedApps: managed.map((packageName) => ({ packageName })) } },
    pendingConfig: null,
  });
  const apk = (packageName: string, versionCode: number, versionName: string, installable = true): LibraryApk => ({
    id: `${packageName}-${versionCode}`,
    fileName: `${packageName}.apk`,
    packageName,
    versionName,
    versionCode,
    createdAt: new Date(versionCode * 1000),
    installable,
  });

  it('finds the tablets behind, as on the real fleet', () => {
    const rows = fleetVersions(
      [tablet('A', [['pro2', 150], ['chrome', 1]]), tablet('B', [['pro2', 145], ['chrome', 2]]), tablet('C', [['pro2', 150], ['chrome', 3]])],
      [apk('pro2', 150, '1.2.3')],
      new Map([['pro2', 'iSMART Pro2']]),
    );
    const pro2 = rows.find((row) => row.packageName === 'pro2')!;
    assert.equal(pro2.state, 'mixed');
    assert.equal(pro2.label, 'iSMART Pro2');
    assert.equal(pro2.latest?.versionCode, 150);
    assert.deepEqual(pro2.versions.map((v) => [v.versionCode, v.versionName, v.behind, v.devices.map((d) => d.name)]), [
      [150, '1.2.3', false, ['A', 'C']],
      [145, null, true, ['B']],
    ]);
    // What came with the tablets is nobody's to look after, and differs from model to model
    assert.equal(rows.some((row) => row.packageName === 'chrome'), false);
    assert.equal(rows[0].packageName, 'pro2');
  });

  it('says when all have the same version and the library has a newer one', () => {
    const [row] = fleetVersions([tablet('A', [['app', 1]]), tablet('B', [['app', 1]])], [apk('app', 2, '2.0')], new Map()).filter((r) => r.packageName === 'app');
    assert.equal(row.state, 'behind');
  });

  it('tells a tablet without the app from one that has not said', () => {
    const silent = { ...tablet('C', []), installedApps: null };
    const [row] = fleetVersions([tablet('A', [['app', 2]]), tablet('B', [['other', 1]]), silent], [apk('app', 2, '2.0')], new Map()).filter((r) => r.packageName === 'app');
    assert.equal(row.state, 'same');
    assert.deepEqual(row.missing.map((d) => d.name), ['B']);
    assert.deepEqual(row.notReported.map((d) => d.name), ['C']);
  });

  it('counts an app on a home screen even when it is not in the library', () => {
    const rows = fleetVersions([tablet('A', [['app', 1]], undefined, ['app']), tablet('B', [['app', 2]], undefined, ['app'])], [], new Map());
    const row = rows.find((r) => r.packageName === 'app')!;
    assert.equal(row.state, 'mixed');
    assert.equal(row.latest, null);
  });

  it('never offers what Android could not install', () => {
    const [row] = fleetVersions([tablet('A', [['app', 1]])], [apk('app', 9, 'part', false), apk('app', 2, '2.0')], new Map()).filter((r) => r.packageName === 'app');
    assert.equal(row.latest?.versionCode, 2);
  });

  it('follows FreeKiosk by the version each heartbeat states', () => {
    const rows = fleetVersions([tablet('A', [], '2.1.0-beta.10'), tablet('B', [], '2.1.0-beta.9')], [apk('com.freekiosk', 62, '2.1.0-beta.10')], new Map());
    const row = rows.find((r) => r.packageName === 'com.freekiosk')!;
    assert.equal(row.label, 'FreeKiosk');
    assert.equal(row.state, 'mixed');
    assert.deepEqual(row.versions.map((v) => [v.versionName, v.behind]), [['2.1.0-beta.10', false], ['2.1.0-beta.9', true]]);
  });
});

describe('on the server', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  const enrolled = async (capabilities = ['screen', 'stop_apps', 'set_volume', 'signage_sync'], token: Record<string, unknown> = {}) => {
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin, token)).token, capabilities);
    return tablet;
  };
  const waiting = (tablet: FakeTablet, hold = 5) => fetch(`${server.base}/api/v1/devices/${tablet.deviceId}/wait/?hold=${hold}`, { headers: tablet.auth() }).then((r) => r.json() as Promise<any>);
  const heldFor = async <T>(work: Promise<T>) => {
    const started = Date.now();
    const value = await work;
    return { value, ms: Date.now() - started };
  };

  describe('a tablet waiting for work', () => {
    it('hears of a command the moment it is sent', async () => {
      const tablet = await enrolled();
      const wait = heldFor(waiting(tablet));
      await new Promise((done) => setTimeout(done, 200));
      await admin.json('POST', '/api/admin/commands', { type: 'wake', target: { deviceIds: [tablet.deviceId] } });
      const { value, ms } = await wait;
      assert.deepEqual(value, { wake: true, commands: true, config: false });
      assert.ok(ms < 2000, `took ${ms} ms`);
    });

    it('hears of a setting the moment it is sent', async () => {
      const tablet = await enrolled();
      const wait = heldFor(waiting(tablet));
      await new Promise((done) => setTimeout(done, 200));
      await admin.json('POST', '/api/admin/commands', { type: 'set_brightness', params: { percent: 40 }, target: { deviceIds: [tablet.deviceId] } });
      const { value, ms } = await wait;
      assert.deepEqual(value, { wake: true, commands: false, config: true });
      assert.ok(ms < 2000, `took ${ms} ms`);
    });

    it('answers at once when something is already waiting', async () => {
      const tablet = await enrolled();
      await admin.json('POST', '/api/admin/commands', { type: 'wake', target: { deviceIds: [tablet.deviceId] } });
      const { value, ms } = await heldFor(waiting(tablet));
      assert.equal(value.commands, true);
      assert.ok(ms < 1500, `took ${ms} ms`);
    });

    it('does not repeat itself once the tablet took what was waiting', async () => {
      const tablet = await enrolled();
      await admin.json('POST', '/api/admin/commands', { type: 'wake', target: { deviceIds: [tablet.deviceId] } });
      await waiting(tablet);
      await tablet.get('commands');
      const { value, ms } = await heldFor(waiting(tablet, 1));
      assert.deepEqual(value, { wake: false, commands: false, config: false });
      assert.ok(ms >= 900, `took ${ms} ms`);
    });

    it('keeps a word said between two requests', async () => {
      const tablet = await enrolled();
      await admin.json('POST', '/api/admin/commands', { type: 'set_brightness', params: { percent: 40 }, target: { deviceIds: [tablet.deviceId] } });
      assert.deepEqual(await waiting(tablet), { wake: true, commands: false, config: true });
      // Said once: the heartbeat that follows takes care of it
      assert.equal((await waiting(tablet, 1)).wake, false);
    });

    it('lets a second request from one tablet replace the first', async () => {
      const tablet = await enrolled();
      const first = waiting(tablet);
      await new Promise((done) => setTimeout(done, 200));
      const second = waiting(tablet, 1);
      assert.equal((await heldFor(first)).ms < 1500, true);
      assert.equal((await first).wake, false);
      assert.equal((await second).wake, false);
    });

    it('never holds longer than the proxies on the way would wait', async () => {
      const tablet = await enrolled();
      await admin.json('POST', '/api/admin/commands', { type: 'wake', target: { deviceIds: [tablet.deviceId] } });
      assert.equal((await waiting(tablet, 9999)).commands, true);
    });

    it('turns away anyone without the key of that tablet', async () => {
      const tablet = await enrolled();
      assert.equal((await fetch(`${server.base}/api/v1/devices/${tablet.deviceId}/wait/`)).status, 401);
    });

    it('tells a playlist change to whoever is waiting', async () => {
      const tablet = await enrolled();
      const playlist = await admin.json<any>('POST', '/api/admin/signage/playlists', { name: `Đánh thức ${Math.random()}` });
      const wait = waiting(tablet);
      await new Promise((done) => setTimeout(done, 200));
      await admin.json('PUT', `/api/admin/signage/playlists/${playlist.id}/assign`, { deviceIds: [tablet.deviceId], groupIds: [] });
      assert.equal((await wait).config, true);
    });
  });

  it('gives the time to anyone, uncached', async () => {
    const before = Date.now();
    const response = await fetch(`${server.base}/api/v1/time/`);
    const { now } = (await response.json()) as any;
    assert.ok(now >= before && now <= Date.now());
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  describe('the volume', () => {
    const send = (tablet: FakeTablet, percent: unknown) => admin.request('POST', '/api/admin/commands', { type: 'set_volume', params: { percent }, target: { deviceIds: [tablet.deviceId] } });

    it('reaches a tablet that can', async () => {
      const tablet = await enrolled();
      assert.equal((await send(tablet, '35')).status, 201);
      const { commands } = (await (await tablet.get('commands')).json()) as any;
      assert.equal(commands[0].type, 'set_volume');
      assert.equal(commands[0].params.percent, '35');
    });

    it('takes 0 to 100 and nothing else', async () => {
      const tablet = await enrolled();
      for (const bad of ['-1', '101', 'to', '']) assert.equal((await send(tablet, bad)).status, 400, String(bad));
      assert.equal((await send(tablet, 0)).status, 201);
      assert.equal((await send(tablet, 100)).status, 201);
    });

    it('skips an older tablet and says why', async () => {
      const tablet = await enrolled(['screen', 'volume']);
      const result = (await (await send(tablet, 50)).json()) as any;
      assert.equal(result.sent, 0);
      assert.match(result.skipped[0].reason, /bản mới nhất/);
    });
  });

  describe('profiles', () => {
    const profileWith = (config: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
      admin.json<any>('POST', '/api/admin/profiles', { name: `Hồ sơ ${Math.random()}`, config, ...extra });

    it('copies one with its settings and its secrets, under a free name', async () => {
      const source = await profileWith({ general: { url: 'https://a/' } }, { description: 'Sảnh', sensitive: { pin: '582913' } });
      const copy = await admin.json<any>('POST', `/api/admin/profiles/${source.id}/duplicate`);
      assert.equal(copy.name, `${source.name} (bản sao)`);
      assert.deepEqual(copy.config, source.config);
      assert.equal(copy.description, 'Sảnh');
      assert.equal(copy.secrets.pin, true);
      assert.equal(copy.sensitiveEnc, undefined);
      const again = await admin.json<any>('POST', `/api/admin/profiles/${source.id}/duplicate`);
      assert.equal(again.name, `${source.name} (bản sao 2)`);
    });

    it('sends a copy to nobody', async () => {
      const source = await profileWith({ general: { url: 'https://a/' } });
      const tablet = await enrolled(undefined, { profileId: source.id });
      await tablet.heartbeat();
      await tablet.heartbeat();
      const before = (await admin.json<any>('GET', `/api/admin/devices/${tablet.deviceId}/config`)).version;
      await admin.json('POST', `/api/admin/profiles/${source.id}/duplicate`);
      assert.equal((await admin.json<any>('GET', `/api/admin/devices/${tablet.deviceId}/config`)).version, before);
    });

    it('shows on the list when a tablet differs from its profile, and takes it back', async () => {
      const profile = await profileWith({ general: { url: 'https://not-what-the-tablet-has/' } });
      const tablet = await enrolled(undefined, { profileId: profile.id });
      await tablet.heartbeat();
      await tablet.heartbeat();
      const rowOf = async () => (await admin.json<any[]>('GET', '/api/admin/devices')).find((d) => d.id === tablet.deviceId);

      const row = await rowOf();
      assert.equal(row.profileStatus.state, 'different');
      assert.equal(row.profileStatus.profile.name, profile.name);
      assert.deepEqual(row.profileStatus.differences, ['general.url']);
      // Never the configuration of the profile: this list goes to anyone who can read
      assert.equal(row.profile.config, undefined);

      const listed = (await admin.json<any[]>('GET', '/api/admin/profiles')).find((p) => p.id === profile.id);
      assert.equal(listed.usedBy, 1);
      assert.equal(listed.differentCount, 1);

      const config = await admin.json<any>('GET', `/api/admin/devices/${tablet.deviceId}/config`);
      assert.deepEqual(config.profileDifferences, [{ path: 'general.url', wanted: 'https://not-what-the-tablet-has/', reported: 'https://example.com/' }]);

      await admin.json('POST', `/api/admin/devices/${tablet.deviceId}/apply-profile`);
      assert.equal((await rowOf()).profileStatus.state, 'pending');

      await tablet.heartbeat();
      await tablet.heartbeat({ config: { general: { url: 'https://not-what-the-tablet-has/' } } });
      assert.equal((await rowOf()).profileStatus.state, 'match');
    });

    it('does not call a tablet different for being in the player of its list, nor takes it out', async () => {
      const profile = await profileWith({ general: { displayMode: 'external_app', url: 'https://a/' } });
      const tablet = await enrolled(undefined, { profileId: profile.id });
      await tablet.heartbeat();
      const inThePlayer = { config: { general: { displayMode: 'media_player', url: 'https://a/' } }, system: { signage_playlist_version: 'v1' } };
      await tablet.heartbeat(inThePlayer);
      const rowOf = async () => (await admin.json<any[]>('GET', '/api/admin/devices')).find((d) => d.id === tablet.deviceId);
      assert.equal((await rowOf()).profileStatus.state, 'match');
      assert.equal((await admin.json<any[]>('GET', '/api/admin/profiles')).find((p) => p.id === profile.id).differentCount, 0);
      assert.deepEqual((await admin.json<any>('GET', `/api/admin/devices/${tablet.deviceId}/config`)).profileDifferences, []);

      await admin.json('POST', `/api/admin/devices/${tablet.deviceId}/apply-profile`);
      const sent = (await tablet.heartbeat(inThePlayer)).data.config;
      assert.equal(sent.general.url, 'https://a/');
      assert.equal(sent.general.displayMode, undefined);

      // The list is gone and it stayed in the player: now it is different, and the profile takes it back
      await tablet.heartbeat({ config: { general: { displayMode: 'media_player', url: 'https://a/' } }, system: { signage_playlist_version: '' } });
      await tablet.heartbeat({ config: { general: { displayMode: 'media_player', url: 'https://a/' } }, system: { signage_playlist_version: '' } });
      assert.deepEqual((await rowOf()).profileStatus.differences, ['general.displayMode']);
      await admin.json('POST', `/api/admin/devices/${tablet.deviceId}/apply-profile`);
      assert.equal((await tablet.heartbeat()).data.config.general.displayMode, 'external_app');
    });

    it('says a tablet has no profile', async () => {
      const tablet = await enrolled();
      assert.equal((await admin.json<any[]>('GET', '/api/admin/devices')).find((d) => d.id === tablet.deviceId).profileStatus.state, 'none');
      assert.equal((await admin.request('POST', `/api/admin/devices/${tablet.deviceId}/apply-profile`)).status, 400);
    });

    it('sends a profile again to everyone using it', async () => {
      const profile = await profileWith({ general: { url: 'https://a/' } });
      const tablet = await enrolled(undefined, { profileId: profile.id });
      await tablet.heartbeat();
      await tablet.heartbeat({ config: { general: { url: 'https://a/' } } });
      const { appliedTo } = await admin.json<any>('POST', `/api/admin/profiles/${profile.id}/apply`);
      assert.equal(appliedTo, 1);
      assert.equal((await tablet.heartbeat()).data.sync_action, 'apply');
    });
  });

  describe('a playlist played in step', () => {
    const newPlaylist = () => admin.json<any>('POST', '/api/admin/signage/playlists', { name: `Đồng bộ ${Math.random()}` });
    const uploadVideo = async () => {
      const id = await uploadInParts(admin, server.base, `video-${Math.random()}.mp4`, mp4(1000, 7500), 'media');
      return admin.json<any>('POST', `/api/admin/media/finish/${id}`, {});
    };
    const manifest = async (tablet: FakeTablet) => (await tablet.get('playlist')).json() as Promise<any>;
    const assign = (playlistId: string, deviceIds: string[], groupIds: string[] = []) => admin.json('PUT', `/api/admin/signage/playlists/${playlistId}/assign`, { deviceIds, groupIds });

    it('tells every screen when the list began and how long a video is', async () => {
      const video = await uploadVideo();
      const playlist = await newPlaylist();
      await admin.json('PUT', `/api/admin/signage/playlists/${playlist.id}/items`, { items: [{ kind: 'video', mediaAssetId: video.id }, { kind: 'image', url: 'https://x/a.png', durationSeconds: 5 }] });
      const [one, two] = [await enrolled(), await enrolled()];
      await assign(playlist.id, [one.deviceId, two.deviceId]);
      const [first, second] = [await manifest(one), await manifest(two)];
      assert.equal(first.items[0].duration_ms, 7500);
      assert.equal(first.items[1].duration_ms, undefined);
      assert.equal(first.sync_epoch_ms, second.sync_epoch_ms);
      assert.equal(first.version, second.version);
    });

    it('starts a list from its first item a moment ahead, so the screens start together', async () => {
      const playlist = await newPlaylist();
      const tablet = await enrolled();
      const before = Date.now();
      await assign(playlist.id, [tablet.deviceId]);
      const epoch = (await manifest(tablet)).sync_epoch_ms;
      assert.ok(epoch >= before + 3000 && epoch <= Date.now() + 10_000, `${epoch - before} ms ahead`);
    });

    it('lets a screen added later join where the list is, without sending the others back', async () => {
      const playlist = await newPlaylist();
      const [one, two] = [await enrolled(), await enrolled()];
      await assign(playlist.id, [one.deviceId]);
      const { sync_epoch_ms: epoch, version } = await manifest(one);
      await assign(playlist.id, [one.deviceId, two.deviceId]);
      assert.equal((await manifest(one)).sync_epoch_ms, epoch);
      assert.equal((await manifest(two)).sync_epoch_ms, epoch);
      assert.equal((await manifest(one)).version, version);
    });

    it('starts over on new content, and on request', async () => {
      const playlist = await newPlaylist();
      const tablet = await enrolled();
      await assign(playlist.id, [tablet.deviceId]);
      const first = (await manifest(tablet)).sync_epoch_ms;
      await new Promise((done) => setTimeout(done, 20));
      await admin.json('PUT', `/api/admin/signage/playlists/${playlist.id}/items`, { items: [{ kind: 'image', url: 'https://x/a.png' }] });
      const second = (await manifest(tablet)).sync_epoch_ms;
      assert.ok(second > first);
      await new Promise((done) => setTimeout(done, 20));
      await admin.json('POST', `/api/admin/signage/playlists/${playlist.id}/restart`);
      const third = await manifest(tablet);
      assert.ok(third.sync_epoch_ms > second);
    });

    it('gives each playlist of a schedule its own start', async () => {
      const [day, night] = [await newPlaylist(), await newPlaylist()];
      const tablet = await enrolled();
      await assign(day.id, [tablet.deviceId]);
      await admin.json('POST', '/api/admin/signage/rules', { playlistId: night.id, deviceId: tablet.deviceId, days: [1, 2, 3, 4, 5, 6, 7], start: '22:00', end: '06:00' });
      const { schedule, sync_epoch_ms: epoch } = await manifest(tablet);
      assert.equal(schedule.playlists[day.id].sync_epoch_ms, epoch);
      assert.equal(typeof schedule.playlists[night.id].sync_epoch_ms, 'number');
    });

    it('says which screens can play in step', async () => {
      const playlist = await newPlaylist();
      const [newer, older] = [await enrolled(), await enrolled(['screen'])];
      await assign(playlist.id, [newer.deviceId, older.deviceId]);
      const { screens } = await admin.json<any>('GET', `/api/admin/signage/playlists/${playlist.id}`);
      assert.equal(screens.find((s: any) => s.id === newer.deviceId).inStep, true);
      assert.equal(screens.find((s: any) => s.id === older.deviceId).inStep, false);
    });
  });

  it('lists the versions of the fleet', async () => {
    const tablet = await enrolled();
    await tablet.heartbeat();
    const rows = await admin.json<any[]>('GET', '/api/admin/apks/fleet-versions');
    assert.ok(rows.some((row) => row.packageName === 'com.freekiosk'));
  });
});
