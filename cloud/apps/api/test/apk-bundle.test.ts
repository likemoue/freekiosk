import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as yauzl from 'yauzl';
import { resetRateLimits } from '../src/common/rate-limit';
import { env } from '../src/config/env';
import { fakeApk, fakeArchive } from './apk-fixture';
import { AdminClient, adminClient, FakeTablet, newToken, startServer, TestServer, uploadInParts } from './helpers';

/** What a tablet that installed iSMART Pro from the Play Store holds, as read from a real one */
const parts = (packageName: string, versionCode = 74) => ({
  base: fakeApk({ package: packageName, versionName: '1.2.3', versionCode, requiredSplitTypes: 'base__abi,base__density', splitTypes: '' }),
  abi: fakeApk({ package: packageName, versionName: '1.2.3', versionCode, split: 'config.arm64_v8a', splitTypes: 'base__abi' }),
  density: fakeApk({ package: packageName, versionName: '1.2.3', versionCode, split: 'config.hdpi', splitTypes: 'base__density' }),
  language: fakeApk({ package: packageName, versionName: '1.2.3', versionCode, split: 'config.vi', splitTypes: '' }),
});

/** The entries of a zip as a reader on the tablet sees them, through its central directory */
function readZip(data: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((done, fail) => {
    yauzl.fromBuffer(data, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return fail(error);
      const entries = new Map<string, Buffer>();
      zip.on('error', fail);
      zip.on('end', () => done(entries));
      zip.on('entry', (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (openError, stream) => {
          if (openError || !stream) return fail(openError);
          const chunks: Buffer[] = [];
          stream.on('data', (chunk) => chunks.push(chunk));
          stream.on('end', () => {
            entries.set(entry.fileName, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

describe('an app in several files', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  const finish = async (fileName: string, content: Buffer) => {
    const uploadId = await uploadInParts(admin, server.base, fileName, content, 'apk');
    return admin.request('POST', `/api/admin/apks/finish/${uploadId}`, {});
  };
  const accepted = async (fileName: string, content: Buffer) => {
    const response = await finish(fileName, content);
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()) as any;
  };
  const refusal = async (fileName: string, content: Buffer) => {
    const response = await finish(fileName, content);
    assert.equal(response.status, 400);
    return ((await response.json()) as any).message as string;
  };

  const tabletAble = async (capabilities: string[]) => {
    resetRateLimits();
    const tablet = new FakeTablet(server.base);
    await tablet.enroll((await newToken(admin)).token, capabilities);
    await tablet.heartbeat({ config: { general: { displayMode: 'external_app', externalApp: { mode: 'multi' }, managedApps: [{ packageName: 'vn.set.iclass', displayName: 'iCLASS', showOnHomeScreen: true }] } }, config_updated_at: new Date().toISOString() });
    await server.prisma.device.update({ where: { id: tablet.deviceId }, data: { capabilities, installedApps: [{ package: 'vn.set.iclass', label: 'iCLASS', version_code: 1 }] } });
    return tablet;
  };

  describe('uploading a set', () => {
    it('takes the files pulled from a tablet, zipped by hand', async () => {
      const p = parts('vn.set.pulled');
      const apk = await accepted('iSMART Pro.zip', fakeArchive({ 'base.apk': p.base, 'split_config.arm64_v8a.apk': p.abi, 'split_config.hdpi.apk': p.density, 'split_config.vi.apk': p.language }));
      assert.equal(apk.packageName, 'vn.set.pulled');
      assert.equal(apk.versionName, '1.2.3');
      assert.equal(apk.versionCode, 74);
      assert.equal(apk.fileName, 'iSMART Pro.zip');
      assert.match(apk.storageKey, /\.zip$/);

      const listed = (await admin.json<any[]>('GET', '/api/admin/apks')).find((row) => row.id === apk.id);
      assert.equal(listed.isBundle, true);
      assert.equal(listed.incomplete, false);
    });

    it('stores only the parts, base first, unchanged, under names the tablet expects', async () => {
      const p = parts('vn.set.stored');
      const apk = await accepted('App.xapk', fakeArchive({
        'manifest.json': Buffer.from('{}'),
        'icon.png': Buffer.from('not an apk'),
        'config.vi.apk': p.language,
        'config.arm64_v8a.apk': p.abi,
        'vn.set.stored.apk': p.base,
        'config.hdpi.apk': p.density,
      }));

      const tablet = await tabletAble(['silent_install', 'split_install']);
      const download = await fetch(`${server.base}/api/v1/devices/${tablet.deviceId}/apk/${apk.id}/`, { headers: tablet.auth() });
      assert.equal(download.status, 200);
      const bytes = Buffer.from(await download.arrayBuffer());
      assert.equal(Number(apk.sizeBytes), bytes.length);

      const entries = await readZip(bytes);
      assert.deepEqual([...entries.keys()].sort(), ['base.apk', 'split_config.arm64_v8a.apk', 'split_config.hdpi.apk', 'split_config.vi.apk']);
      assert.equal([...entries.keys()][0], 'base.apk');
      assert.deepEqual(entries.get('base.apk'), p.base);
      assert.deepEqual(entries.get('split_config.arm64_v8a.apk'), p.abi);
      assert.equal(entries.has('AndroidManifest.xml'), false);
    });

    it('takes the layout of bundletool, leaving out what is for older Android', async () => {
      const p = parts('vn.set.bundletool');
      const apk = await accepted('App.apks', fakeArchive({
        'toc.pb': Buffer.from('table of contents'),
        'splits/base-master.apk': p.base,
        'splits/base-arm64_v8a.apk': p.abi,
        'splits/base-hdpi.apk': p.density,
        'standalones/standalone-arm64_v8a_hdpi.apk': fakeApk({ package: 'vn.set.bundletool', versionName: '1.2.3', versionCode: 74 }),
      }));
      assert.equal(apk.packageName, 'vn.set.bundletool');
      assert.match(apk.storageKey, /\.zip$/);
    });

    it('stores a universal APK as a plain APK', async () => {
      const apk = await accepted('App.apks', fakeArchive({
        'toc.pb': Buffer.from('table of contents'),
        'universal.apk': fakeApk({ package: 'vn.set.universal', versionName: '1.0', versionCode: 1 }),
      }));
      assert.match(apk.storageKey, /\.apk$/);
      const listed = (await admin.json<any[]>('GET', '/api/admin/apks')).find((row) => row.id === apk.id);
      assert.equal(listed.isBundle, false);
    });

    it('accepts the file types the sites use, and no others', async () => {
      const p = parts('vn.set.types');
      const archive = fakeArchive({ 'base.apk': p.base, 'a.apk': p.abi, 'b.apk': p.density });
      for (const name of ['a.apks', 'a.xapk', 'a.apkm', 'a.zip', 'A.ZIP']) await accepted(name, archive);
      assert.match(await refusal('a.rar', archive), /Chỉ nhận/);
    });

    it('says which part is missing', async () => {
      const p = parts('vn.set.missing');
      assert.match(await refusal('a.zip', fakeArchive({ 'base.apk': p.base, 'a.apk': p.density })), /phần theo CPU/);
      assert.match(await refusal('a.zip', fakeArchive({ 'base.apk': p.base, 'a.apk': p.abi })), /phần theo độ phân giải/);
      assert.match(await refusal('a.zip', fakeArchive({ 'base.apk': p.base })), /phần theo CPU và phần theo độ phân giải/);
      // A language is not something the base requires
      assert.ok(await accepted('a.zip', fakeArchive({ 'base.apk': p.base, 'a.apk': p.abi, 'b.apk': p.density })));
    });

    it('refuses a set that Android would refuse, saying why', async () => {
      const p = parts('vn.set.bad');
      const other = parts('vn.set.other');
      const older = parts('vn.set.bad', 70);
      assert.match(await refusal('a.zip', fakeArchive({ 'a.apk': p.abi, 'b.apk': p.density })), /thiếu tệp gốc/);
      assert.match(await refusal('a.zip', fakeArchive({ 'a.apk': p.base, 'b.apk': other.base })), /nhiều hơn một tệp gốc/);
      assert.match(await refusal('a.zip', fakeArchive({ 'a.apk': p.base, 'b.apk': other.abi, 'c.apk': p.density })), /ứng dụng khác/);
      assert.match(await refusal('a.zip', fakeArchive({ 'a.apk': p.base, 'b.apk': older.abi, 'c.apk': p.density })), /phiên bản khác/);
      assert.match(await refusal('a.zip', fakeArchive({ 'a.apk': p.base, 'b.apk': p.abi, 'c.apk': p.abi, 'd.apk': p.density })), /trùng nhau/);
      assert.match(await refusal('a.zip', fakeArchive({ 'a.apk': p.base, 'b.apk': p.abi, 'c.apk': p.density, 'Android/obb/main.obb': Buffer.from('data') })), /OBB/);
      assert.match(await refusal('a.zip', fakeArchive({ 'a.apk': Buffer.from('not an apk') })), /không phải tệp APK/);
      assert.match(await refusal('a.zip', fakeArchive({ 'readme.txt': Buffer.from('nothing') })), /không có tệp .apk/);
      assert.match(await refusal('a.zip', Buffer.from('not a zip at all')), /Không đọc được tệp nén/);
    });

    it('never lets an archive decide where a file goes', async () => {
      const p = parts('vn.set.paths');
      const apk = await accepted('a.zip', fakeArchive({ 'x/y/z/base.apk': p.base, 'a b/c.apk': p.abi, 'd/e.apk': p.density }));
      const entries = await readZip(await readStored(apk.storageKey));
      assert.deepEqual([...entries.keys()].sort(), ['base.apk', 'split_config.arm64_v8a.apk', 'split_config.hdpi.apk']);
    });

    it('leaves no temporary files behind', async () => {
      const { readdir } = await import('node:fs/promises');
      const left = (await readdir(join(env().dataDir, 'tmp'))).filter((name) => /^bundle-|^upload-/.test(name));
      assert.deepEqual(left, []);
    });
  });

  const readStored = async (storageKey: string) => {
    const { readFile } = await import('node:fs/promises');
    return readFile(join(env().dataDir, storageKey));
  };

  describe('sending a set to tablets', () => {
    const bundle = async (packageName: string) => {
      const p = parts(packageName);
      return accepted(`${packageName}.zip`, fakeArchive({ 'base.apk': p.base, 'a.apk': p.abi, 'b.apk': p.density }));
    };

    it('goes only to a tablet that knows how to install one', async () => {
      const apk = await bundle('vn.set.deploy');
      const able = await tabletAble(['silent_install', 'split_install']);
      const old = await tabletAble(['silent_install']);
      const notOwner = await tabletAble(['screen']);

      const result = await admin.json('POST', `/api/admin/apks/${apk.id}/deploy`, { target: { deviceIds: [able.deviceId, old.deviceId, notOwner.deviceId] } });
      assert.equal(result.sent, 1);
      const reasons = Object.fromEntries(result.skipped.map((s: any) => [s.deviceId, s.reason]));
      assert.match(reasons[old.deviceId], /FreeKiosk bản mới nhất/);
      assert.match(reasons[notOwner.deviceId], /Device Owner/);

      const updates: any = await (await able.get('updates')).json();
      assert.equal(updates[0].package_name, 'vn.set.deploy');
    });

    it('still reaches an older tablet with a plain APK', async () => {
      const single = await server.prisma.apkPackage.create({
        data: { fileName: 'don.apk', storageKey: 'apk/don.apk', sizeBytes: 3, sha256Hex: 'ab', checksumBase64: 'q6s', packageName: 'vn.set.single', versionName: '1', versionCode: 1 },
      });
      await writeFile(join(env().dataDir, single.storageKey), fakeApk({ package: 'vn.set.single', versionName: '1' }));
      const old = await tabletAble(['silent_install']);
      const result = await admin.json('POST', `/api/admin/apks/${single.id}/deploy`, { target: { deviceIds: [old.deviceId] } });
      assert.equal(result.sent, 1);
    });

    it('is installed by the picker, and shown once it has worked', async () => {
      await bundle('vn.set.picker');
      const tablet = await tabletAble(['silent_install', 'split_install']);
      const target = { deviceIds: [tablet.deviceId] };

      const row = (await admin.json('POST', '/api/admin/home-apps/preview', { target })).apps.find((a: any) => a.packageName === 'vn.set.picker');
      assert.equal(row.canInstall, true);
      assert.equal(row.apkIncomplete, false);
      assert.equal(row.label, 'vn.set.picker');

      const result = await admin.json('POST', '/api/admin/home-apps/apply', { target, add: ['vn.set.picker'] });
      assert.equal(result.installs, 1);

      const updates: any = await (await tablet.get('updates')).json();
      await tablet.sendResult(updates[0].command_id, 'success', {});
      const general = (await tablet.heartbeat()).data.config.general;
      assert.ok(general.managedApps.some((a: any) => a.packageName === 'vn.set.picker'));
    });

    it('tells the picker why an older tablet cannot take it', async () => {
      await bundle('vn.set.old');
      const tablet = await tabletAble(['silent_install']);
      const result = await admin.json('POST', '/api/admin/home-apps/apply', { target: { deviceIds: [tablet.deviceId] }, add: ['vn.set.old'] });
      assert.equal(result.installs, 0);
      assert.match(result.skipped[0].reason, /cần cài FreeKiosk bản mới nhất/);
    });

    it('wins over an incomplete upload of the same app', async () => {
      const p = parts('vn.set.both');
      await server.prisma.apkPackage.create({
        data: { fileName: 'chi-goc.apk', storageKey: 'apk/chi-goc.apk', sizeBytes: 3, sha256Hex: 'ab', checksumBase64: 'q6s', packageName: 'vn.set.both', versionName: '1.2.2', versionCode: 90 },
      });
      await writeFile(join(env().dataDir, 'apk/chi-goc.apk'), p.base);
      const set = await accepted('du-bo.zip', fakeArchive({ 'base.apk': p.base, 'a.apk': p.abi, 'b.apk': p.density }));

      const tablet = await tabletAble(['silent_install', 'split_install']);
      await admin.json('POST', '/api/admin/home-apps/apply', { target: { deviceIds: [tablet.deviceId] }, add: ['vn.set.both'] });
      const updates: any = await (await tablet.get('updates')).json();
      assert.ok(updates[0].download_url.includes(set.id));
    });

    it('cannot be what the setup wizard downloads', async () => {
      const p = parts('com.freekiosk');
      const apk = await accepted('FreeKiosk.zip', fakeArchive({ 'base.apk': p.base, 'a.apk': p.abi, 'b.apk': p.density }));
      assert.equal((await admin.request('POST', `/api/admin/apks/${apk.id}/provisioning`)).status, 400);
    });
  });
});
