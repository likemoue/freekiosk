import * as yauzl from 'yauzl';

/**
 * The USB install tool (scripts/cai-tablet-usb) asks this website for its newer version at each start.
 * Its build script makes the archive uploaded here: every file of the tool, `phien-ban.json` listing
 * them with their SHA-256, and `phien-ban.sig`, a signature of that list by a key kept on the machine
 * that builds the tool. The tool checks the signature against the key it was built with: a website
 * that is taken over cannot hand every installing PC a program of its own.
 */
export const MANIFEST_NAME = 'phien-ban.json';
export const SIGNATURE_NAME = 'phien-ban.sig';
export const TOOL_PROGRAM = 'CaiTablet.exe';

/** yyyy.MM.dd.HHmm: compared as text by the tool */
const VERSION = /^\d{4}\.\d{2}\.\d{2}\.\d{4}$/;
const SAFE_PATH = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/;
const MAX_LIST_BYTES = 64 * 1024;
const MAX_FILES = 50;

export class UsbToolError extends Error {}

export interface UsbToolFile {
  path: string;
  sha256: string;
  size: number;
}

export interface UsbToolManifest {
  version: string;
  apkVersion: string | null;
  files: UsbToolFile[];
}

/** As kept in the settings, and shown on the APK page */
export interface UsbToolRelease {
  version: string;
  apkVersion: string | null;
  sizeBytes: number;
  sha256: string;
  storageKey: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string | null;
}

export const isNewerVersion = (candidate: string, current: string | null | undefined) => !current || candidate > current;

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((done, fail) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) fail(new UsbToolError('Không đọc được tệp nén: tệp hỏng hoặc không phải tệp .zip'));
      else done(zip);
    });
  });
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((done, fail) => {
    if (entry.uncompressedSize > MAX_LIST_BYTES) return fail(new UsbToolError(`${entry.fileName} quá lớn`));
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return fail(new UsbToolError(`Không đọc được ${entry.fileName}`));
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', () => fail(new UsbToolError(`Không đọc được ${entry.fileName}`)));
      stream.on('end', () => done(Buffer.concat(chunks)));
    });
  });
}

/** The names in the archive, and the list with its signature. What is wrong is said to the person uploading */
export async function readUsbToolPackage(file: string): Promise<UsbToolManifest> {
  const zip = await openZip(file);
  const names = new Map<string, number>();
  const found: { list?: Buffer; signature?: Buffer } = {};
  try {
    await new Promise<void>((done, fail) => {
      // yauzl refuses a name that leaves the folder before this code sees it
      zip.on('error', (error: Error) =>
        fail(new UsbToolError(/relative path|absolute path|invalid characters/.test(String(error?.message)) ? 'Tệp nén có tên tệp không hợp lệ' : 'Không đọc được tệp nén: tệp hỏng')),
      );
      zip.on('end', () => done());
      zip.on('entry', (entry: yauzl.Entry) => {
        const name = entry.fileName.replace(/\\/g, '/');
        if (entry.isEncrypted()) return fail(new UsbToolError('Tệp nén này được đặt mật khẩu nên không đọc được'));
        if (name.endsWith('/')) return zip.readEntry();
        names.set(name, entry.uncompressedSize);
        if (name !== MANIFEST_NAME && name !== SIGNATURE_NAME) return zip.readEntry();
        readEntry(zip, entry).then((content) => {
          if (name === MANIFEST_NAME) found.list = content;
          else found.signature = content;
          zip.readEntry();
        }, fail);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }

  if (!found.list) throw new UsbToolError(`Thiếu ${MANIFEST_NAME}: hãy tải lên tệp .zip do build.ps1 của công cụ tạo ra`);
  if (!found.signature?.toString('utf8').trim()) throw new UsbToolError(`Thiếu chữ ký ${SIGNATURE_NAME}: công cụ sẽ không nhận bản này`);
  let parsed: any;
  try {
    parsed = JSON.parse(found.list.toString('utf8').replace(/^\uFEFF/, ''));
  } catch {
    throw new UsbToolError(`${MANIFEST_NAME} không đọc được`);
  }
  const version = typeof parsed?.version === 'string' ? parsed.version : '';
  if (!VERSION.test(version)) throw new UsbToolError(`Phiên bản trong ${MANIFEST_NAME} không hợp lệ`);
  const files: UsbToolFile[] = Array.isArray(parsed.files) ? parsed.files : [];
  if (!files.length || files.length > MAX_FILES) throw new UsbToolError(`Danh sách tệp trong ${MANIFEST_NAME} không hợp lệ`);
  for (const entry of files) {
    if (typeof entry?.path !== 'string' || !SAFE_PATH.test(entry.path) || entry.path.split('/').some((part) => part === '..')) {
      throw new UsbToolError('Tên tệp trong danh sách không hợp lệ');
    }
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw new UsbToolError(`Thiếu SHA-256 của ${entry.path}`);
    if (names.get(entry.path) !== entry.size) throw new UsbToolError(`Tệp nén thiếu ${entry.path} hoặc kích thước không khớp`);
  }
  if (!files.some((entry) => entry.path === TOOL_PROGRAM)) throw new UsbToolError(`Tệp nén không có ${TOOL_PROGRAM}`);
  return {
    version,
    apkVersion: typeof parsed.apkVersion === 'string' ? parsed.apkVersion.slice(0, 40) : null,
    files: files.map((entry) => ({ path: entry.path, sha256: entry.sha256, size: entry.size })),
  };
}
