import { createReadStream, createWriteStream, WriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { crc32 } from 'node:zlib';
import * as yauzl from 'yauzl';
import { ApkManifest, readApkManifest } from './apk-reader';

/** What a set of APKs comes as: from bundletool, APKPure, APKMirror, or zipped by hand */
export const BUNDLE_EXTENSIONS = ['.apks', '.xapk', '.apkm', '.zip'];

const MAX_PARTS = 200;
// Under the 4 GB a plain zip can address, and far above any real app
const MAX_TOTAL_BYTES = 3.5 * 1024 * 1024 * 1024;

const SPLIT_TYPE_WORDS: Record<string, string> = {
  base__abi: 'phần theo CPU',
  base__density: 'phần theo độ phân giải màn hình',
  base__texture: 'phần theo định dạng ảnh',
};

/** What is wrong with an uploaded set, in words for the person who uploaded it */
export class BundleError extends Error {}

export interface ApkBundle {
  /** The manifest of the base APK, which says what the app is */
  manifest: ApkManifest;
  /** A zip of the parts, or the APK itself when one file is all the app needs */
  file: string;
  isBundle: boolean;
  parts: string[];
}

interface Extracted {
  source: string;
  file: string;
}

function isApkEntry(name: string): boolean {
  if (!/\.apk$/i.test(name)) return false;
  // bundletool also writes whole APKs for old Android next to the splits
  if (/^standalones\//i.test(name) || /^__MACOSX\//.test(name)) return false;
  return !basename(name).startsWith('._');
}

function openZip(file: string): Promise<yauzl.ZipFile> {
  return new Promise((done, fail) => {
    yauzl.open(file, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) fail(new BundleError('Không đọc được tệp nén: tệp hỏng hoặc không phải tệp .zip'));
      else done(zip);
    });
  });
}

/** Every APK in the archive, written to `dir`. Nothing from the archive decides a path */
async function extractApks(file: string, dir: string): Promise<Extracted[]> {
  const zip = await openZip(file);
  return new Promise((done, fail) => {
    const found: Extracted[] = [];
    let total = 0;
    const refuse = (message: string) => {
      zip.close();
      fail(new BundleError(message));
    };
    zip.on('error', () => refuse('Không đọc được tệp nén: tệp hỏng'));
    zip.on('end', () => done(found));
    zip.on('entry', (entry: yauzl.Entry) => {
      const name = entry.fileName;
      if (/\.obb$/i.test(name)) return refuse('Bộ này có tệp dữ liệu OBB, website chưa cài được loại này');
      if (name.endsWith('/') || !isApkEntry(name)) return zip.readEntry();
      if (entry.isEncrypted()) return refuse('Tệp nén này được đặt mật khẩu nên không đọc được');
      total += entry.uncompressedSize;
      if (total > MAX_TOTAL_BYTES || found.length >= MAX_PARTS) return refuse('Bộ này quá lớn để cài');
      zip.openReadStream(entry, (error, stream) => {
        if (error || !stream) return refuse(`Không đọc được ${name}`);
        const target = join(dir, `part-${found.length}.apk`);
        pipeline(stream, createWriteStream(target)).then(
          () => {
            found.push({ source: name, file: target });
            zip.readEntry();
          },
          () => refuse(`Không đọc được ${name}`),
        );
      });
    });
    zip.readEntry();
  });
}

const safeName = (split: string) => split.replace(/[^a-zA-Z0-9._-]/g, '_');

/** The name of a part inside the stored zip: the tablet finds the base by it */
const partName = (manifest: ApkManifest) => (manifest.splitName ? `split_${safeName(manifest.splitName)}.apk` : 'base.apk');

const DOS_DATE_1980 = 0x0021;

/**
 * A zip that stores the parts as they are, with their sizes in the headers. APKs are compressed
 * already, and a reader on the tablet needs nothing but the central directory.
 */
async function writeStoredZip(entries: Array<{ name: string; file: string }>, target: string): Promise<void> {
  const out = createWriteStream(target);
  const write = (out_: WriteStream, data: Buffer) => new Promise<void>((done, fail) => out_.write(data, (error) => (error ? fail(error) : done())));
  const u16 = (value: number) => {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value);
    return b;
  };
  const u32 = (value: number) => {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value);
    return b;
  };

  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const { size } = await stat(entry.file);
    let crc = 0;
    for await (const chunk of createReadStream(entry.file)) crc = crc32(chunk as Buffer, crc);
    const name = Buffer.from(entry.name);
    const common = Buffer.concat([u16(20), u16(0), u16(0), u16(0), u16(DOS_DATE_1980), u32(crc), u32(size), u32(size), u16(name.length), u16(0)]);
    const local = Buffer.concat([u32(0x04034b50), common, name]);
    await write(out, local);
    await pipeline(createReadStream(entry.file), out, { end: false });
    central.push(Buffer.concat([u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length + size;
  }
  const directory = Buffer.concat(central);
  await write(out, directory);
  await write(out, Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(directory.length), u32(offset), u16(0)]));
  await new Promise<void>((done, fail) => out.end((error?: Error | null) => (error ? fail(error) : done())));
}

/**
 * Reads an uploaded set and makes sure Android will take it: one base, all parts of the same app and
 * version, and every part the base declares it needs. Better refused here, with the reason, than
 * failing on each tablet. What is stored is a zip of only those parts, whatever the source put
 * around them, so that the tablet has nothing to choose.
 */
export async function readApkBundle(file: string, dir: string): Promise<ApkBundle> {
  let extracted = await extractApks(file, dir);
  if (!extracted.length) throw new BundleError('Trong tệp nén không có tệp .apk nào');

  // bundletool --mode=universal: one complete APK, nothing else matters
  const universal = extracted.find((item) => basename(item.source).toLowerCase() === 'universal.apk');
  if (universal) extracted = [universal];

  const parts: Array<Extracted & { manifest: ApkManifest }> = [];
  for (const item of extracted) {
    const manifest = await readApkManifest(item.file);
    if (!manifest) throw new BundleError(`${basename(item.source)} không phải tệp APK đọc được`);
    parts.push({ ...item, manifest });
  }

  const bases = parts.filter((part) => !part.manifest.splitName);
  if (bases.length === 0) throw new BundleError('Bộ này thiếu tệp gốc (base.apk)');
  if (bases.length > 1) throw new BundleError(`Bộ này có nhiều hơn một tệp gốc: ${bases.map((part) => basename(part.source)).join(', ')}`);
  const base = bases[0];

  for (const part of parts) {
    const other = part.manifest;
    if (other.packageName !== base.manifest.packageName) {
      throw new BundleError(`${basename(part.source)} là của ứng dụng khác (${other.packageName}, không phải ${base.manifest.packageName})`);
    }
    if (other.versionCode !== base.manifest.versionCode) {
      throw new BundleError(`${basename(part.source)} là của phiên bản khác: các tệp trong bộ phải lấy cùng một lúc`);
    }
  }
  const names = parts.map((part) => partName(part.manifest));
  const repeated = names.find((name, index) => names.indexOf(name) !== index);
  if (repeated) throw new BundleError(`Bộ này có hai tệp trùng nhau: ${repeated}`);

  const provided = new Set(parts.flatMap((part) => part.manifest.splitTypes));
  const missing = base.manifest.requiredSplitTypes.filter((type) => !provided.has(type));
  if (missing.length) {
    throw new BundleError(`Bộ này còn thiếu ${missing.map((type) => SPLIT_TYPE_WORDS[type] ?? type).join(' và ')} nên Android sẽ không cài được`);
  }
  if (base.manifest.incomplete && parts.length === 1) {
    throw new BundleError('Bộ này chỉ có tệp gốc, còn thiếu các phần khác của ứng dụng nên Android sẽ không cài được');
  }

  if (parts.length === 1) return { manifest: base.manifest, file: base.file, isBundle: false, parts: names };

  const target = join(dir, 'bundle.zip');
  // The base first: it is what the tablet reads to check the app
  const ordered = [...parts].sort((a, b) => Number(!!a.manifest.splitName) - Number(!!b.manifest.splitName));
  await writeStoredZip(ordered.map((part) => ({ name: partName(part.manifest), file: part.file })), target);
  return { manifest: base.manifest, file: target, isBundle: true, parts: ordered.map((part) => partName(part.manifest)) };
}
