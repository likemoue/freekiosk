import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { resetRateLimits } from '../src/common/rate-limit';
import { env } from '../src/config/env';
import { needsOtherParts } from '../src/files/apk-reader';
import { fakeApk } from './apk-fixture';
import { AdminClient, adminClient, FakeTablet, newToken, startServer, TestServer, uploadInParts } from './helpers';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('not much of an image')]).toString('base64');

const app = (packageName: string, displayName = packageName, extra: Record<string, unknown> = {}) => ({
  packageName,
  displayName,
  showOnHomeScreen: true,
  launchOnBoot: false,
  keepAlive: false,
  allowAccessibility: false,
  ...extra,
});

const reported = (managedApps: unknown[], mode = 'multi') => ({
  config: { general: { displayMode: 'external_app', externalApp: { mode }, managedApps } },
  config_updated_at: new Date().toISOString(),
});

const installed = (...packages: string[]) => packages.map((p) => ({ package: p, label: p.split('.').pop(), version_code: 1 }));

describe('the apps on the home screen', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  const post = async (tablet: FakeTablet, path: string, body: unknown) => {
    const response = await fetch(`${server.base}/api/v1/devices/${tablet.deviceId}/${path}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...tablet.auth() },
      body: JSON.stringify(body),
    });
    return { status: response.status, data: (await response.json()) as any };
  };

  const enrolled = async (options: { capabilities?: string[]; token?: Record<string, unknown> } = {}) => {
    // Enrollment is limited per address, and this suite enrolls far more tablets than anyone would
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin, options.token)).token, options.capabilities ?? ['silent_install']);
    return tablet;
  };

  /** A tablet with these apps on its screen and these installed, as it would tell the website */
  const tabletWith = async (home: unknown[], apps?: string[], options: { capabilities?: string[]; token?: Record<string, unknown>; mode?: string } = {}) => {
    const tablet = await enrolled(options);
    await tablet.heartbeat(reported(home, options.mode));
    // A heartbeat reports what the fake tablet can do: this one is told otherwise
    if (options.capabilities) await server.prisma.device.update({ where: { id: tablet.deviceId }, data: { capabilities: options.capabilities } });
    if (apps) await post(tablet, 'apps', { hash: `h-${tablet.deviceId}`, apps: installed(...apps) });
    return tablet;
  };

  const preview = (target: unknown) => admin.json('POST', '/api/admin/home-apps/preview', { target });
  const apply = (target: unknown, change: Record<string, unknown>) => admin.json('POST', '/api/admin/home-apps/apply', { target, ...change });

  /** What the tablet receives at its next heartbeat */
  const pushed = async (tablet: FakeTablet) => (await tablet.heartbeat()).data.config?.general;

  const historyOf = async (tablet: FakeTablet) => admin.json<any[]>('GET', `/api/admin/commands?deviceId=${tablet.deviceId}`);

  const uploaded = (packageName: string, fileName = `${packageName}.apk`) =>
    server.prisma.apkPackage.create({
      data: { fileName, storageKey: `apk/${fileName}`, sizeBytes: 3, sha256Hex: 'ab', checksumBase64: 'q6s', packageName, versionName: '1.2.2', versionCode: 70 },
    });

  describe('what a tablet reports', () => {
    it('sends its list only when asked, and is asked only when the list changed', async () => {
      const tablet = await enrolled();
      assert.equal((await tablet.heartbeat()).data.installed_apps_wanted, false);
      assert.equal((await tablet.heartbeat({ installed_apps_hash: 'one' })).data.installed_apps_wanted, true);

      const { status, data } = await post(tablet, 'apps', { hash: 'one', apps: installed('vn.report.alpha') });
      assert.equal(status, 200);
      assert.deepEqual(data.icons_wanted, ['vn.report.alpha']);

      assert.equal((await tablet.heartbeat({ installed_apps_hash: 'one' })).data.installed_apps_wanted, false);
      assert.equal((await tablet.heartbeat({ installed_apps_hash: 'two' })).data.installed_apps_wanted, true);
    });

    it('asks for icons in small rounds, again at the next heartbeat if a round was lost', async () => {
      const tablet = await enrolled();
      const packages = Array.from({ length: 10 }, (_, i) => `vn.rounds.app${i}`);
      const first = (await post(tablet, 'apps', { hash: 'x', apps: installed(...packages) })).data.icons_wanted;
      assert.equal(first.length, 8);

      // The tablet lost its connection here. The next heartbeat picks it up
      assert.deepEqual((await tablet.heartbeat()).data.app_icons_wanted, first);

      const second = (await post(tablet, 'app-icons', { icons: first.map((p: string) => ({ package: p, png_base64: PNG })) })).data.icons_wanted;
      assert.deepEqual(second, packages.slice(8));

      const done = await post(tablet, 'app-icons', { icons: second.map((p: string) => ({ package: p, png_base64: PNG })) });
      assert.deepEqual(done.data.icons_wanted, []);
      assert.deepEqual((await tablet.heartbeat()).data.app_icons_wanted, []);
    });

    it('needs each icon only once across the fleet', async () => {
      const one = await enrolled();
      await post(one, 'apps', { hash: 'a', apps: installed('vn.shared.app') });
      await post(one, 'app-icons', { icons: [{ package: 'vn.shared.app', png_base64: PNG }] });

      const other = await enrolled();
      assert.deepEqual((await post(other, 'apps', { hash: 'b', apps: installed('vn.shared.app') })).data.icons_wanted, []);
    });

    it('asks again for a newer version, and an older one does not overwrite it', async () => {
      const newer = await enrolled();
      const older = await enrolled();
      await post(newer, 'apps', { hash: 'a', apps: [{ package: 'vn.versions.app', label: 'A', version_code: 2 }] });
      await post(newer, 'app-icons', { icons: [{ package: 'vn.versions.app', png_base64: PNG }] });

      assert.deepEqual((await post(older, 'apps', { hash: 'a', apps: [{ package: 'vn.versions.app', label: 'A', version_code: 1 }] })).data.icons_wanted, []);
      assert.deepEqual((await post(newer, 'apps', { hash: 'b', apps: [{ package: 'vn.versions.app', label: 'A', version_code: 3 }] })).data.icons_wanted, ['vn.versions.app']);
    });

    it('does not ask again for an icon the tablet could not read', async () => {
      const tablet = await enrolled();
      await post(tablet, 'apps', { hash: 'a', apps: installed('vn.noicon.app') });
      const { data } = await post(tablet, 'app-icons', { icons: [{ package: 'vn.noicon.app', png_base64: null }] });
      assert.deepEqual(data.icons_wanted, []);
      assert.equal((await admin.request('GET', '/api/admin/home-apps/icons/vn.noicon.app')).status, 404);
    });

    it('keeps only real PNG images, for apps the tablet says it has', async () => {
      const tablet = await enrolled();
      await post(tablet, 'apps', { hash: 'a', apps: installed('vn.png.app') });
      await post(tablet, 'app-icons', {
        icons: [
          { package: 'vn.png.app', png_base64: Buffer.from('<svg onload="alert(1)"/>').toString('base64') },
          { package: 'vn.png.elsewhere', png_base64: PNG },
        ],
      });
      assert.equal((await admin.request('GET', '/api/admin/home-apps/icons/vn.png.app')).status, 404);
      assert.equal(await server.prisma.appInfo.count({ where: { packageName: 'vn.png.elsewhere' } }), 0);
    });

    it('drops what does not read as an app', async () => {
      const tablet = await enrolled();
      await post(tablet, 'apps', { hash: 'a', apps: [{ package: '../etc/passwd', label: 'x' }, { nothing: true }, ...installed('vn.clean.app')] });
      const row = await server.prisma.device.findUniqueOrThrow({ where: { id: tablet.deviceId } });
      assert.deepEqual((row.installedApps as any[]).map((a) => a.package), ['vn.clean.app']);
    });

    it('takes a list only with the key of the device', async () => {
      const tablet = await enrolled();
      const response = await fetch(`${server.base}/api/v1/devices/${tablet.deviceId}/apps/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: 'a', apps: [] }),
      });
      assert.equal(response.status, 401);
    });
  });

  describe('the picker', () => {
    it('shows each app by name and icon, with how many tablets have it on screen', async () => {
      const one = await tabletWith([app('vn.pick.iclass', 'iCLASS')], ['vn.pick.iclass', 'vn.pick.chrome', 'com.freekiosk']);
      const two = await tabletWith([app('vn.pick.iclass', 'iCLASS'), app('vn.pick.chrome', 'Chrome')], ['vn.pick.iclass', 'vn.pick.chrome']);
      await post(one, 'apps', { hash: 'again', apps: [{ package: 'vn.pick.iclass', label: 'iCLASS', version_code: 1 }, { package: 'vn.pick.chrome', label: 'Chrome', version_code: 1 }] });
      await post(one, 'app-icons', { icons: [{ package: 'vn.pick.iclass', png_base64: PNG }] });

      const result = await preview({ deviceIds: [one.deviceId, two.deviceId] });
      assert.equal(result.deviceCount, 2);
      assert.equal(result.notReporting, 0);
      assert.equal(result.notMultiApp, 0);

      const iclass = result.apps.find((a: any) => a.packageName === 'vn.pick.iclass');
      assert.equal(iclass.label, 'iCLASS');
      assert.equal(iclass.onHome, 2);
      assert.equal(iclass.installed, 2);
      assert.match(iclass.iconUrl, /^\/api\/admin\/home-apps\/icons\/vn\.pick\.iclass\?v=1$/);

      const chrome = result.apps.find((a: any) => a.packageName === 'vn.pick.chrome');
      assert.equal(chrome.onHome, 1);
      assert.equal(chrome.iconUrl, null);

      // Its own screen is not a choice
      assert.equal(result.apps.some((a: any) => a.packageName === 'com.freekiosk'), false);
    });

    it('offers an uploaded APK too, named after its file', async () => {
      await server.prisma.apkPackage.create({
        data: { fileName: 'iSMART iPro.apk', storageKey: 'apk/ipro.apk', sizeBytes: 3, sha256Hex: 'ab', checksumBase64: 'q6s', packageName: 'vn.pick.ipro', versionName: '1.0', versionCode: 1 },
      });
      const tablet = await tabletWith([app('vn.pick.iclass', 'iCLASS')], ['vn.pick.iclass']);
      const ipro = (await preview({ deviceIds: [tablet.deviceId] })).apps.find((a: any) => a.packageName === 'vn.pick.ipro');
      assert.equal(ipro.label, 'iSMART iPro');
      assert.equal(ipro.canInstall, true);
      assert.equal(ipro.installed, 0);
    });

    it('says which tablets have not reported, and which do not show a list', async () => {
      const silent = await tabletWith([app('vn.pick.iclass')]);
      const single = await tabletWith([app('vn.pick.iclass')], ['vn.pick.iclass'], { mode: 'single' });
      const result = await preview({ deviceIds: [silent.deviceId, single.deviceId] });
      assert.equal(result.notReporting, 1);
      assert.equal(result.notMultiApp, 1);
    });

    it('serves an icon only inside a session', async () => {
      const tablet = await enrolled();
      await post(tablet, 'apps', { hash: 'a', apps: installed('vn.icon.app') });
      await post(tablet, 'app-icons', { icons: [{ package: 'vn.icon.app', png_base64: PNG }] });

      const response = await admin.request('GET', '/api/admin/home-apps/icons/vn.icon.app');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), 'image/png');
      assert.equal(Buffer.from(await response.arrayBuffer()).toString('base64'), PNG);

      assert.equal((await fetch(`${server.base}/api/admin/home-apps/icons/vn.icon.app`)).status, 401);
      assert.equal((await admin.request('GET', '/api/admin/home-apps/icons/not-a-package')).status, 404);
    });
  });

  describe('applying a change', () => {
    it('works out a list for each tablet, leaving what differs between them', async () => {
      const one = await tabletWith([app('vn.do.iclass', 'iCLASS')], ['vn.do.iclass', 'vn.do.chrome']);
      const two = await tabletWith([app('vn.do.iclass', 'iCLASS'), app('vn.do.maps', 'Maps')], ['vn.do.iclass', 'vn.do.maps', 'vn.do.chrome']);

      const result = await apply({ deviceIds: [one.deviceId, two.deviceId] }, { add: ['vn.do.chrome'] });
      assert.equal(result.sent, 2);
      assert.deepEqual(result.skipped, []);

      assert.deepEqual((await pushed(one)).managedApps.map((a: any) => a.packageName), ['vn.do.iclass', 'vn.do.chrome']);
      assert.deepEqual((await pushed(two)).managedApps.map((a: any) => a.packageName), ['vn.do.iclass', 'vn.do.maps', 'vn.do.chrome']);
    });

    it('shows the change at once in the picker, while the tablet has yet to receive it', async () => {
      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass', 'vn.do.chrome']);
      await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.do.chrome'] });
      const result = await preview({ deviceIds: [tablet.deviceId] });
      assert.equal(result.pending, 1);
      assert.equal(result.apps.find((a: any) => a.packageName === 'vn.do.chrome').onHome, 1);
    });

    it('adds the fields the app expects to a new entry, with the name it goes by', async () => {
      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass', 'vn.do.named']);
      await post(tablet, 'apps', { hash: 'n', apps: [...installed('vn.do.iclass'), { package: 'vn.do.named', label: 'Tên đẹp', version_code: 1 }] });
      await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.do.named'] });
      const entry = (await pushed(tablet)).managedApps.find((a: any) => a.packageName === 'vn.do.named');
      assert.deepEqual(entry, app('vn.do.named', 'Tên đẹp'));
    });

    it('removes an app, but keeps one that has another job, hidden', async () => {
      const tablet = await tabletWith(
        [app('vn.do.iclass'), app('vn.do.plain'), app('vn.do.keeper', 'Keeper', { keepAlive: true, custom: 'kept' })],
        ['vn.do.iclass', 'vn.do.plain', 'vn.do.keeper'],
      );
      await apply({ deviceIds: [tablet.deviceId] }, { remove: ['vn.do.plain', 'vn.do.keeper'] });
      assert.deepEqual((await pushed(tablet)).managedApps, [
        app('vn.do.iclass'),
        app('vn.do.keeper', 'Keeper', { keepAlive: true, custom: 'kept', showOnHomeScreen: false }),
      ]);
    });

    it('brings back a hidden app instead of adding it twice', async () => {
      const tablet = await tabletWith([app('vn.do.iclass'), app('vn.do.hidden', 'Ẩn', { showOnHomeScreen: false, launchOnBoot: true })], ['vn.do.iclass', 'vn.do.hidden']);
      await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.do.hidden'] });
      assert.deepEqual((await pushed(tablet)).managedApps, [app('vn.do.iclass'), app('vn.do.hidden', 'Ẩn', { launchOnBoot: true })]);
    });

    it('can take the last app off the screen, as a screen with no apps is fine', async () => {
      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass']);
      const result = await apply({ deviceIds: [tablet.deviceId] }, { remove: ['vn.do.iclass'] });
      assert.equal(result.sent, 1);
      assert.deepEqual(result.skipped, []);
      assert.deepEqual((await pushed(tablet)).managedApps, []);
    });

    it('sends nothing to a tablet that already has it that way', async () => {
      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass']);
      const result = await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.do.iclass'] });
      assert.equal(result.sent, 0);
      assert.equal((await tablet.heartbeat()).data.config, null);
    });

    it('installs an uploaded app first, and shows it once the tablet says it worked', async () => {
      const apk = await uploaded('vn.install.ok', 'Ứng dụng cài.apk');
      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass']);
      const target = { deviceIds: [tablet.deviceId] };

      const result = await apply(target, { add: ['vn.install.ok'] });
      assert.equal(result.installs, 1);
      assert.equal(result.sent, 0);

      // Nothing on the screen yet, and the picker says it is on its way
      assert.equal((await tablet.heartbeat(reported([app('vn.do.iclass')]))).data.config, null);
      const during = (await preview(target)).apps.find((a: any) => a.packageName === 'vn.install.ok');
      assert.equal(during.installing, 1);
      assert.equal(during.onHome, 0);

      const updates: any = await (await tablet.get('updates')).json();
      assert.equal(updates.length, 1);
      assert.ok(updates[0].download_url.includes(apk.id));
      assert.equal((await tablet.sendResult(updates[0].command_id, 'success', { install_status: 'success' })).status, 200);

      const general = await pushed(tablet);
      assert.deepEqual(general.managedApps.map((a: any) => a.packageName), ['vn.do.iclass', 'vn.install.ok']);
      assert.equal(general.managedApps[1].displayName, 'Ứng dụng cài');

      const after = (await preview(target)).apps.find((a: any) => a.packageName === 'vn.install.ok');
      assert.equal(after.installed, 1);
      assert.equal(after.installing, 0);
      assert.equal(after.onHome, 1);
    });

    it('leaves the screen as it was when the install fails', async () => {
      await uploaded('vn.install.fails');
      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass']);
      await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.install.fails'] });

      const updates: any = await (await tablet.get('updates')).json();
      await tablet.sendResult(updates[0].command_id, 'error', null, 'Install failed (status 1): INSTALL_FAILED_INTERNAL_ERROR');

      assert.equal((await tablet.heartbeat()).data.config, null);
      const entry = (await preview({ deviceIds: [tablet.deviceId] })).apps.find((a: any) => a.packageName === 'vn.install.fails');
      assert.equal(entry.onHome, 0);
      assert.equal(entry.installing, 0);
      // And it can be tried again
      assert.equal((await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.install.fails'] })).installs, 1);
    });

    it('does what it can at once, and the rest after the install', async () => {
      await uploaded('vn.install.mixed');
      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass', 'vn.do.chrome']);
      const result = await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.do.chrome', 'vn.install.mixed'] });
      assert.equal(result.sent, 1);
      assert.equal(result.installs, 1);
      assert.deepEqual((await pushed(tablet)).managedApps.map((a: any) => a.packageName), ['vn.do.iclass', 'vn.do.chrome']);
    });

    it('does not send a second install while one is on its way', async () => {
      await uploaded('vn.install.once');
      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass']);
      assert.equal((await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.install.once'] })).installs, 1);
      const again = await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.install.once'] });
      assert.equal(again.installs, 0);
      assert.deepEqual(again.skipped, []);
    });

    it('says which apps are on a screen but not on the tablet', async () => {
      const tablet = await tabletWith([app('vn.do.iclass'), app('vn.do.ghost', 'Không có thật')], ['vn.do.iclass']);
      const ghost = (await preview({ deviceIds: [tablet.deviceId] })).apps.find((a: any) => a.packageName === 'vn.do.ghost');
      assert.equal(ghost.onHome, 1);
      assert.equal(ghost.installed, 0);
      // Taking it off is an ordinary removal
      assert.equal((await apply({ deviceIds: [tablet.deviceId] }, { remove: ['vn.do.ghost'] })).sent, 1);
    });

    it('does not reinstall an app the tablet has', async () => {
      await uploaded('vn.do.have');
      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass', 'vn.do.have']);
      assert.equal((await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.do.have'] })).installs, 0);
    });

    it('skips a tablet that lacks the app and has no way to get it', async () => {
      const noApk = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass']);
      let result = await apply({ deviceIds: [noApk.deviceId] }, { add: ['vn.do.nowhere'] });
      assert.equal(result.sent, 0);
      assert.match(result.skipped[0].reason, /Chưa cài/);

      await uploaded('vn.do.owner');
      const notOwner = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass'], { capabilities: ['screen'] });
      result = await apply({ deviceIds: [notOwner.deviceId] }, { add: ['vn.do.owner'] });
      assert.equal(result.installs, 0);
      assert.match(result.skipped[0].reason, /Chưa cài/);
    });

    it('still adds on a tablet that has not said what it has', async () => {
      const tablet = await tabletWith([app('vn.do.iclass')]);
      const result = await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.do.unknown'] });
      assert.equal(result.sent, 1);
      assert.deepEqual(result.skipped, []);
    });

    it('moves a tablet to the app grid only when asked', async () => {
      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass', 'vn.do.chrome'], { mode: 'single' });
      await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.do.chrome'] });
      assert.equal((await pushed(tablet)).externalApp, undefined);

      const other = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass', 'vn.do.chrome'], { mode: 'single' });
      await apply({ deviceIds: [other.deviceId] }, { add: ['vn.do.chrome'], switchToMulti: true });
      const general = await pushed(other);
      assert.equal(general.displayMode, 'external_app');
      assert.deepEqual(general.externalApp, { mode: 'multi' });
    });

    it('refuses an empty change, an app both added and removed, and a bad package name', async () => {
      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass']);
      const target = { deviceIds: [tablet.deviceId] };
      const status = async (change: unknown) => (await admin.request('POST', '/api/admin/home-apps/apply', { target, ...(change as object) })).status;
      assert.equal(await status({}), 400);
      assert.equal(await status({ add: ['vn.do.x'], remove: ['vn.do.x'] }), 400);
      assert.equal(await status({ add: ['khong hop le'] }), 400);
      assert.equal((await admin.request('POST', '/api/admin/home-apps/apply', { target: {}, add: ['vn.do.x'] })).status, 400);
    });

    it('is for administrators and operators, and leaves a trace', async () => {
      const { temporaryPassword } = await admin.json('POST', '/api/admin/users', { email: 'xem-ungdung@test.local', name: 'Xem', role: 'VIEWER' });
      const viewer = new AdminClient(server.base);
      await viewer.login('xem-ungdung@test.local', temporaryPassword);
      await viewer.request('POST', '/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: 'Xem-Ung-Dung-Mat-Khau-9' });

      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass', 'vn.do.chrome']);
      const target = { deviceIds: [tablet.deviceId] };
      assert.equal((await viewer.request('POST', '/api/admin/home-apps/preview', { target })).status, 200);
      assert.equal((await viewer.request('POST', '/api/admin/home-apps/apply', { target, add: ['vn.do.chrome'] })).status, 403);

      await apply(target, { add: ['vn.do.chrome'] });
      const log = await server.prisma.activityLog.findFirstOrThrow({ where: { action: 'config.changed' }, orderBy: { createdAt: 'desc' } });
      assert.match(log.message, /đã đổi ứng dụng trên màn hình của 1 thiết bị: thêm/);
    });
  });

  describe('the command history', () => {
    it('keeps a line for each tablet, in words, without sending the tablet a command', async () => {
      const tablet = await tabletWith([app('vn.hist.iclass', 'iCLASS'), app('vn.hist.old', 'Cũ')], ['vn.hist.iclass', 'vn.hist.old', 'vn.hist.chrome']);
      await post(tablet, 'apps', { hash: 'labels', apps: [{ package: 'vn.hist.iclass', label: 'iCLASS', version_code: 1 }, { package: 'vn.hist.old', label: 'Cũ', version_code: 1 }, { package: 'vn.hist.chrome', label: 'Chrome', version_code: 1 }] });
      await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.hist.chrome'], remove: ['vn.hist.old'] });

      const [line, ...others] = await historyOf(tablet);
      assert.equal(others.length, 0);
      assert.equal(line.type, 'home_apps');
      assert.equal(line.status, 'SENT');
      assert.deepEqual(line.params, { add: ['Chrome'], remove: ['Cũ'] });
      assert.equal(line.createdBy, 'admin@test.local');

      const beat = await tablet.heartbeat();
      assert.equal(beat.data.pending_commands, 0);
      assert.deepEqual(((await (await tablet.get('commands')).json()) as any).commands, []);
      assert.deepEqual(await (await tablet.get('updates')).json(), []);
    });

    it('turns to success once the tablet has confirmed the change', async () => {
      const tablet = await tabletWith([app('vn.hist.iclass')], ['vn.hist.iclass', 'vn.hist.chrome']);
      await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.hist.chrome'] });

      await tablet.heartbeat(); // receives it
      assert.equal((await historyOf(tablet))[0].status, 'SENT');
      await tablet.heartbeat(); // has it
      const [line] = await historyOf(tablet);
      assert.equal(line.status, 'SUCCESS');
      assert.ok(line.completedAt);
    });

    it('does not count a newer change as confirmed by an older one', async () => {
      const tablet = await tabletWith([app('vn.hist.iclass')], ['vn.hist.iclass', 'vn.hist.a', 'vn.hist.b']);
      await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.hist.a'] });
      await tablet.heartbeat(); // receives the first
      await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.hist.b'] });
      await tablet.heartbeat(); // receives the second, so nothing is confirmed yet
      assert.deepEqual((await historyOf(tablet)).map((line) => line.status), ['SENT', 'SENT']);
      await tablet.heartbeat();
      assert.deepEqual((await historyOf(tablet)).map((line) => line.status), ['SUCCESS', 'SUCCESS']);
    });

    it('records why a tablet was skipped', async () => {
      const other = await tabletWith([app('vn.hist.iclass')], ['vn.hist.iclass']);
      await apply({ deviceIds: [other.deviceId] }, { add: ['vn.hist.nowhere'] });
      const [refused] = await historyOf(other);
      assert.equal(refused.status, 'ERROR');
      assert.match(refused.errorMessage, /chưa có APK/);
    });

    it('adds nothing when there was nothing to do', async () => {
      const tablet = await tabletWith([app('vn.hist.iclass')], ['vn.hist.iclass']);
      await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.hist.iclass'] });
      assert.deepEqual(await historyOf(tablet), []);
    });

    it('shows the install, then the app joining the screen', async () => {
      await uploaded('vn.hist.upload', 'Tải lên.apk');
      const tablet = await tabletWith([app('vn.hist.iclass')], ['vn.hist.iclass']);
      await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.hist.upload'] });

      const updates: any = await (await tablet.get('updates')).json();
      await tablet.sendResult(updates[0].command_id, 'success', {});

      const lines = await historyOf(tablet);
      assert.deepEqual(lines.map((line) => [line.type, line.status]), [['home_apps', 'SENT'], ['install_apk', 'SUCCESS']]);
      assert.deepEqual(lines[0].params, { add: ['Tải lên'] });
      assert.equal(lines[0].createdBy, 'admin@test.local');
    });

    it('survives a tablet that was away past the expiry, once it comes back', async () => {
      const tablet = await tabletWith([app('vn.hist.iclass')], ['vn.hist.iclass', 'vn.hist.chrome']);
      await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.hist.chrome'] });
      await server.prisma.command.updateMany({ where: { deviceId: tablet.deviceId }, data: { status: 'EXPIRED' } });
      await tablet.heartbeat();
      await tablet.heartbeat();
      assert.equal((await historyOf(tablet))[0].status, 'SUCCESS');
    });
  });

  describe('an APK that is only a part of an app', () => {
    // What the real iSMART iPro.apk declares, read from the file
    const BASE_ONLY = { package: 'vn.split.base', versionName: '1.2.2', requiredSplitTypes: 'base__abi,base__density', splitTypes: '' };

    const placeIncomplete = async (packageName: string) => {
      const apk = await uploaded(packageName);
      await writeFile(join(env().dataDir, apk.storageKey), fakeApk({ ...BASE_ONLY, package: packageName }));
      return apk;
    };

    it('is told apart from a complete one, in every form the declaration takes', () => {
      assert.equal(needsOtherParts({ package: 'a.b', requiredSplitTypes: 'base__abi,base__density' }), true);
      assert.equal(needsOtherParts({ package: 'a.b', split: 'config.arm64_v8a' }), true);
      assert.equal(needsOtherParts({ package: 'a.b', application: { isSplitRequired: true } }), true);
      assert.equal(needsOtherParts({ package: 'a.b', application: { metaDatas: [{ name: 'com.android.vending.splits.required', value: true }] } }), true);

      assert.equal(needsOtherParts({ package: 'a.b', splitTypes: '', application: { metaDatas: [{ name: 'other', value: true }] } }), false);
      assert.equal(needsOtherParts({ package: 'a.b', application: { isSplitRequired: false } }), false);
      assert.equal(needsOtherParts(null), false);
    });

    it('is refused at upload, saying what is needed instead', async () => {
      const uploadId = await uploadInParts(admin, server.base, 'iSMART iPro.apk', fakeApk(BASE_ONLY), 'apk');
      const response = await admin.request('POST', `/api/admin/apks/finish/${uploadId}`, {});
      assert.equal(response.status, 400);
      assert.match(((await response.json()) as any).message, /cả bộ/);
      assert.equal(await server.prisma.apkPackage.count({ where: { packageName: BASE_ONLY.package } }), 0);
    });

    it('does not stop a complete one being uploaded', async () => {
      const uploadId = await uploadInParts(admin, server.base, 'đầy đủ.apk', fakeApk({ package: 'vn.split.full', versionName: '1.0' }), 'apk');
      const apk = await admin.json('POST', `/api/admin/apks/finish/${uploadId}`, {});
      assert.equal(apk.packageName, 'vn.split.full');
      const listed = (await admin.json<any[]>('GET', '/api/admin/apks')).find((row) => row.id === apk.id);
      assert.equal(listed.incomplete, false);
    });

    it('is flagged when it is already on the server, and cannot be sent', async () => {
      const apk = await placeIncomplete('vn.split.old');
      const listed = (await admin.json<any[]>('GET', '/api/admin/apks')).find((row) => row.id === apk.id);
      assert.equal(listed.incomplete, true);

      const tablet = await enrolled();
      const response = await admin.request('POST', `/api/admin/apks/${apk.id}/deploy`, { target: { deviceIds: [tablet.deviceId] } });
      assert.equal(response.status, 400);
      assert.equal((await tablet.heartbeat()).data.pending_commands, 0);
    });

    it('is not installed by the picker, which says why and leaves the screen alone', async () => {
      await placeIncomplete('vn.split.pick');
      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass']);
      const target = { deviceIds: [tablet.deviceId] };

      const entry = (await preview(target)).apps.find((a: any) => a.packageName === 'vn.split.pick');
      assert.equal(entry.canInstall, false);
      assert.equal(entry.apkIncomplete, true);

      const result = await apply(target, { add: ['vn.split.pick'] });
      assert.equal(result.installs, 0);
      assert.equal(result.sent, 0);
      assert.match(result.skipped[0].reason, /cả bộ/);
      assert.equal((await tablet.heartbeat()).data.config, null);
      assert.deepEqual(await (await tablet.get('updates')).json(), []);
      assert.equal((await historyOf(tablet))[0].status, 'ERROR');
    });

    it('does not hide an older complete upload of the same app', async () => {
      const complete = await server.prisma.apkPackage.create({
        data: { fileName: 'cu.apk', storageKey: 'apk/cu-day-du.apk', sizeBytes: 3, sha256Hex: 'ab', checksumBase64: 'q6s', packageName: 'vn.split.both', versionName: '1.0', versionCode: 1 },
      });
      await writeFile(join(env().dataDir, complete.storageKey), fakeApk({ package: 'vn.split.both', versionName: '1.0' }));
      await placeIncomplete('vn.split.both');

      const tablet = await tabletWith([app('vn.do.iclass')], ['vn.do.iclass']);
      assert.equal((await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.split.both'] })).installs, 1);
      const updates: any = await (await tablet.get('updates')).json();
      assert.ok(updates[0].download_url.includes(complete.id));
    });

    it('stays out of the profile of a group when no tablet could take it', async () => {
      await placeIncomplete('vn.split.group');
      const profile = await admin.json('POST', '/api/admin/profiles', { name: 'Hồ sơ thiếu phần', config: { general: { displayMode: 'external_app', managedApps: [app('vn.do.iclass')] } } });
      const group = await admin.json('POST', '/api/admin/groups', { name: 'Nhóm thiếu phần', profileId: profile.id });
      await tabletWith([app('vn.do.iclass')], ['vn.do.iclass'], { token: { groupId: group.id } });

      await apply({ groupId: group.id }, { add: ['vn.split.group'] });
      const stored = await server.prisma.configProfile.findUniqueOrThrow({ where: { id: profile.id } });
      assert.deepEqual((stored.config as any).general.managedApps.map((a: any) => a.packageName), ['vn.do.iclass']);
    });
  });

  describe('a group', () => {
    const newGroup = async (name: string, config?: Record<string, unknown>) => {
      const profile = config ? await admin.json('POST', '/api/admin/profiles', { name: `Hồ sơ ${name}`, config }) : null;
      const group = await admin.json('POST', '/api/admin/groups', { name, profileId: profile?.id });
      return { group, profile };
    };
    const profileGeneral = async (id: string) => ((await server.prisma.configProfile.findUniqueOrThrow({ where: { id } })).config as any).general;

    it('reaches every tablet of the group, and only those', async () => {
      const { group } = await newGroup('Nhóm phạm vi');
      const inside = await tabletWith([app('vn.grp.iclass')], ['vn.grp.iclass', 'vn.grp.chrome'], { token: { groupId: group.id } });
      const outside = await tabletWith([app('vn.grp.iclass')], ['vn.grp.iclass', 'vn.grp.chrome']);

      const result = await apply({ groupId: group.id }, { add: ['vn.grp.chrome'] });
      assert.equal(result.sent, 1);
      assert.equal(result.profile, null);
      assert.ok((await pushed(inside)).managedApps.some((a: any) => a.packageName === 'vn.grp.chrome'));
      assert.equal((await outside.heartbeat()).data.config, null);
    });

    it('keeps the profile of the group up to date, so a new tablet comes up the same', async () => {
      const { group, profile } = await newGroup('Nhóm hồ sơ', { general: { displayMode: 'external_app', externalApp: { package: 'vn.grp.iclass' }, url: 'https://giu-nguyen.test/' } });
      const tablet = await tabletWith([app('vn.grp.iclass', 'iCLASS')], ['vn.grp.iclass', 'vn.grp.chrome'], { token: { groupId: group.id } });
      await tablet.heartbeat(); // takes what the profile sent at enrollment
      await tablet.heartbeat(reported([app('vn.grp.iclass', 'iCLASS')]));

      const result = await apply({ groupId: group.id }, { add: ['vn.grp.chrome'] });
      assert.deepEqual(result.profile, { name: profile.name, updated: true });

      const general = await profileGeneral(profile.id);
      assert.deepEqual(general.managedApps.map((a: any) => a.packageName), ['vn.grp.iclass', 'vn.grp.chrome']);
      // What the profile already said stays, and a list needs the app grid to be seen
      assert.equal(general.url, 'https://giu-nguyen.test/');
      assert.deepEqual(general.externalApp, { package: 'vn.grp.iclass', mode: 'multi' });

      const late = await enrolled({ token: { groupId: group.id } });
      assert.deepEqual((await pushed(late)).managedApps.map((a: any) => a.packageName), ['vn.grp.iclass', 'vn.grp.chrome']);
    });

    it('changes the list a profile already has, and a mode it states stays', async () => {
      const { group, profile } = await newGroup('Nhóm có danh sách', {
        general: { displayMode: 'external_app', externalApp: { mode: 'single' }, managedApps: [app('vn.grp.iclass'), app('vn.grp.old')] },
      });
      await tabletWith([app('vn.grp.iclass'), app('vn.grp.old')], ['vn.grp.iclass', 'vn.grp.old'], { token: { groupId: group.id } });
      await apply({ groupId: group.id }, { remove: ['vn.grp.old'] });

      const general = await profileGeneral(profile.id);
      assert.deepEqual(general.managedApps.map((a: any) => a.packageName), ['vn.grp.iclass']);
      assert.equal(general.externalApp.mode, 'single');
    });

    it('leaves alone a profile that other groups use, and says so', async () => {
      const { group, profile } = await newGroup('Nhóm dùng chung', { general: { displayMode: 'external_app', managedApps: [app('vn.grp.iclass')] } });
      await admin.json('POST', '/api/admin/groups', { name: 'Nhóm khác cùng hồ sơ', profileId: profile.id });
      await tabletWith([app('vn.grp.iclass')], ['vn.grp.iclass', 'vn.grp.chrome'], { token: { groupId: group.id } });

      const result = await apply({ groupId: group.id }, { add: ['vn.grp.chrome'] });
      assert.deepEqual(result.profile, { name: profile.name, updated: false });
      assert.deepEqual((await profileGeneral(profile.id)).managedApps.map((a: any) => a.packageName), ['vn.grp.iclass']);
    });

    it('does not touch a profile when the target is one tablet of the group', async () => {
      const { group, profile } = await newGroup('Nhóm một máy', { general: { displayMode: 'external_app', managedApps: [app('vn.grp.iclass')] } });
      const tablet = await tabletWith([app('vn.grp.iclass')], ['vn.grp.iclass', 'vn.grp.chrome'], { token: { groupId: group.id } });
      const result = await apply({ deviceIds: [tablet.deviceId] }, { add: ['vn.grp.chrome'] });
      assert.equal(result.profile, null);
      assert.deepEqual((await profileGeneral(profile.id)).managedApps.map((a: any) => a.packageName), ['vn.grp.iclass']);
    });
  });
});
