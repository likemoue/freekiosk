import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { fakeArchive } from './apk-fixture';
import { AdminClient, adminClient, startServer, TestServer, uploadInParts } from './helpers';

const sha256 = (content: Buffer) => createHash('sha256').update(content).digest('hex');

/** As build.ps1 packs the tool: its files, the list of them, and a signature of the list */
function toolPackage(version: string, extra: { files?: Record<string, Buffer>; list?: unknown; signature?: string | null } = {}) {
  const files = extra.files ?? {
    'CaiTablet.exe': Buffer.from(`MZ chương trình ${version}`),
    'FreeKiosk.apk': Buffer.from('PK apk'),
    'adb/adb.exe': Buffer.from('MZ adb'),
  };
  const list = extra.list ?? {
    version,
    apkVersion: '2.1.0-beta.14',
    files: Object.entries(files).map(([path, content]) => ({ path, sha256: sha256(content), size: content.length })),
  };
  const archive: Record<string, Buffer> = { ...files, 'phien-ban.json': Buffer.from(JSON.stringify(list)) };
  if (extra.signature !== null) archive['phien-ban.sig'] = Buffer.from(extra.signature ?? 'chu-ky-gia');
  return fakeArchive(archive);
}

describe('the USB install tool on the website', () => {
  let server: TestServer;
  let admin: AdminClient;

  before(async () => {
    server = await startServer();
    admin = await adminClient(server);
  });
  after(() => server.close());

  const upload = async (content: Buffer, fileName = 'CaiTablet-USB.zip') => {
    const id = await uploadInParts(admin, server.base, fileName, content, 'usb_tool');
    return admin.request('POST', `/api/admin/usb-tool/finish/${id}`, {});
  };
  const info = () => fetch(`${server.base}/api/public/usb-tool`);

  it('says there is none yet, to the tool that asks before anyone signs in', async () => {
    const response = await info();
    assert.equal(response.status, 404);
  });

  it('takes the archive of build.ps1 and hands it to the tool, with what to check it by', async () => {
    const archive = toolPackage('2026.11.06.0900');
    const response = await upload(archive);
    assert.equal(response.status, 201);
    const { release } = (await response.json()) as any;
    assert.equal(release.version, '2026.11.06.0900');
    assert.equal(release.apkVersion, '2.1.0-beta.14');
    assert.equal(release.storageKey, undefined);

    const answer = (await (await info()).json()) as any;
    assert.equal(answer.version, '2026.11.06.0900');
    assert.equal(answer.sha256, sha256(archive));
    assert.equal(answer.size, archive.length);

    const download = await fetch(`${server.base}${answer.download}`);
    assert.equal(download.status, 200);
    assert.match(download.headers.get('content-disposition') ?? '', /CaiTablet-USB-2026\.11\.06\.0900\.zip/);
    assert.equal(sha256(Buffer.from(await download.arrayBuffer())), sha256(archive));

    const entry = await server.prisma.activityLog.findFirst({ where: { action: 'usb_tool.uploaded' } });
    assert.ok(entry?.message.includes('2026.11.06.0900'));
  });

  it('only ever moves forward', async () => {
    const response = await upload(toolPackage('2026.11.05.0900'));
    assert.equal(response.status, 400);
    assert.match(((await response.json()) as any).message, /không mới hơn/);
    assert.equal(((await (await info()).json()) as any).version, '2026.11.06.0900');
  });

  it('replaces the archive it kept with the newer one', async () => {
    const before = await server.prisma.appSetting.findUnique({ where: { key: 'usbTool' } });
    assert.equal((await upload(toolPackage('2026.11.07.0800'))).status, 201);
    const after = await server.prisma.appSetting.findUnique({ where: { key: 'usbTool' } });
    assert.notEqual((after!.value as any).storageKey, (before!.value as any).storageKey);
    assert.equal(((await (await info()).json()) as any).version, '2026.11.07.0800');
  });

  describe('says what is wrong with an archive the tool would refuse', () => {
    const refused = async (content: Buffer, pattern: RegExp, fileName?: string) => {
      const response = await upload(content, fileName);
      assert.equal(response.status, 400);
      assert.match(((await response.json()) as any).message, pattern);
    };

    it('one with no signature', () => refused(toolPackage('2026.12.01.0000', { signature: null }), /chữ ký/));
    it('one whose list names a file it lacks', () =>
      refused(toolPackage('2026.12.01.0000', { list: { version: '2026.12.01.0000', files: [{ path: 'CaiTablet.exe', sha256: 'a'.repeat(64), size: 3 }] } }), /kích thước không khớp|thiếu/i));
    it('one with a path out of its folder', () =>
      refused(toolPackage('2026.12.01.0000', { files: { 'CaiTablet.exe': Buffer.from('MZ'), '../thoat.exe': Buffer.from('MZ') } }), /không hợp lệ/));
    it('one with no program', () => refused(toolPackage('2026.12.01.0000', { files: { 'FreeKiosk.apk': Buffer.from('PK') } }), /CaiTablet\.exe/));
    it('one with no version', () => refused(toolPackage('2026.12.01.0000', { list: { files: [] } }), /Phiên bản/));
    it('something else than a zip', () => refused(Buffer.from('khong phai zip'), /\.zip/, 'CaiTablet-USB.exe'));
  });

  it('lets only an administrator put out a new one', async () => {
    const { temporaryPassword } = await admin.json('POST', '/api/admin/users', { email: 'cong-cu@test.local', name: 'Vận hành', role: 'OPERATOR' });
    const operator = new AdminClient(server.base);
    await operator.login('cong-cu@test.local', temporaryPassword);
    await operator.json('POST', '/api/admin/auth/password', { currentPassword: temporaryPassword, newPassword: 'Mat-khau-van-hanh-12345' });
    const id = await uploadInParts(operator, server.base, 'CaiTablet-USB.zip', toolPackage('2026.12.02.0000'), 'usb_tool');
    assert.equal((await operator.request('POST', `/api/admin/usb-tool/finish/${id}`, {})).status, 403);
  });
});
