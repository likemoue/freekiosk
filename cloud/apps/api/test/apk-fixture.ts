/**
 * A very small APK, for what the server reads from one: a zip holding a binary AndroidManifest.xml
 * with a <manifest> element and the attributes given. Android would not install it, and nothing
 * here asks it to.
 */

function crc32(data: Buffer): number {
  let crc = ~0;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

const u16 = (value: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(value);
  return b;
};
const u32 = (value: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(value >>> 0);
  return b;
};

/** The chunks of Android's binary XML: a string pool, then the start and end of one element */
function binaryManifest(attributes: Record<string, string | number>): Buffer {
  const strings: string[] = [];
  const index = (text: string) => {
    if (!strings.includes(text)) strings.push(text);
    return strings.indexOf(text);
  };
  const element = index('manifest');
  const attrs = Object.entries(attributes).map(([name, value]) => [index(name), typeof value === 'number' ? value : index(value), typeof value === 'number'] as const);

  const encoded = strings.map((text) => Buffer.concat([u16(text.length), Buffer.from(text, 'utf16le'), u16(0)]));
  const offsets: Buffer[] = [];
  let offset = 0;
  for (const item of encoded) {
    offsets.push(u32(offset));
    offset += item.length;
  }
  const poolHeaderSize = 28;
  const pool = Buffer.concat([...offsets, ...encoded]);
  const padding = Buffer.alloc((4 - (pool.length % 4)) % 4);
  const stringPool = Buffer.concat([
    u16(0x0001), u16(poolHeaderSize), u32(poolHeaderSize + pool.length + padding.length),
    u32(strings.length), u32(0), u32(0), u32(poolHeaderSize + offsets.length * 4), u32(0),
    pool, padding,
  ]);

  const none = 0xffffffff;
  // A number has no raw string, and its own type: this is how versionCode comes in a real manifest
  const attributeBytes = attrs.map(([name, value, isNumber]) =>
    Buffer.concat([u32(none), u32(name), u32(isNumber ? none : value), u16(8), Buffer.from([0, isNumber ? 0x10 : 0x03]), u32(value)]),
  );
  const start = Buffer.concat([
    u16(0x0102), u16(16), u32(16 + 20 + attributeBytes.length * 20), u32(1), u32(none),
    u32(none), u32(element), u16(20), u16(20), u16(attributeBytes.length), u16(0), u16(0), u16(0),
    ...attributeBytes,
  ]);
  const end = Buffer.concat([u16(0x0103), u16(16), u32(24), u32(1), u32(none), u32(none), u32(element)]);

  const body = Buffer.concat([stringPool, start, end]);
  return Buffer.concat([u16(0x0003), u16(8), u32(8 + body.length), body]);
}

/** A zip with stored entries: all an APK reader looks at */
function zipWith(files: Record<string, Buffer>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const common = Buffer.concat([u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(crc32(data)), u32(data.length), u32(data.length), u16(nameBytes.length), u16(0)]);
    const local = Buffer.concat([u32(0x04034b50), common, nameBytes, data]);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), common, u16(0), u16(0), u16(0), u32(0), u32(offset), nameBytes]));
    locals.push(local);
    offset += local.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(directory.length), u32(offset), u16(0)]);
  return Buffer.concat([...locals, directory, end]);
}

export function fakeApk(attributes: Record<string, string | number>): Buffer {
  return zipWith({ 'AndroidManifest.xml': binaryManifest(attributes) });
}

/** A set of files in one archive, the way bundletool, APKPure or a person would pack them */
export function fakeArchive(files: Record<string, Buffer>): Buffer {
  return zipWith(files);
}
