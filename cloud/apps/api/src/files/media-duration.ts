import { open } from 'node:fs/promises';

/**
 * How long a video is, in milliseconds, read from its container, or null when it does not say.
 *
 * Screens that play in step work out where they should be from the length of every item, so they all
 * need the same number. A browser's answer can differ by a hair from one WebView version to the next,
 * and a hair per round adds up, so the server reads it once and every screen gets the same one.
 * No ffmpeg in the image for this: both containers state it in a few bytes.
 */
export async function readVideoDurationMs(path: string): Promise<number | null> {
  const file = await open(path, 'r');
  try {
    const head = Buffer.alloc(12);
    const { bytesRead } = await file.read(head, 0, 12, 0);
    if (bytesRead < 12) return null;
    if (head.readUInt32BE(0) === 0x1a45dfa3) return await readMatroska(file);
    return await readIsoMedia(file, (await file.stat()).size);
  } catch {
    return null;
  } finally {
    await file.close();
  }
}

type Reader = Awaited<ReturnType<typeof open>>;

async function bytesAt(file: Reader, position: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await file.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** The boxes between two positions: [type, start of its content, end] */
async function* boxes(file: Reader, start: number, end: number): AsyncGenerator<[string, number, number]> {
  let at = start;
  while (at + 8 <= end) {
    const header = await bytesAt(file, at, 16);
    if (header.length < 8) return;
    let size = header.readUInt32BE(0);
    const type = header.toString('latin1', 4, 8);
    let content = at + 8;
    if (size === 1) {
      if (header.length < 16) return;
      size = Number(header.readBigUInt64BE(8));
      content = at + 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < 8 || at + size > end + 8) return;
    yield [type, content, at + size];
    at += size;
  }
}

/** MP4, MOV and the like: moov/mvhd, or moov/mvex/mehd when the file comes in fragments */
async function readIsoMedia(file: Reader, size: number): Promise<number | null> {
  for await (const [type, start, end] of boxes(file, 0, size)) {
    if (type !== 'moov') continue;
    let timescale = 0;
    let duration = 0;
    let fragments = 0;
    for await (const [child, childStart, childEnd] of boxes(file, start, end)) {
      if (child === 'mvhd') {
        const box = await bytesAt(file, childStart, 32);
        if (box.length < 20) return null;
        if (box[0] === 1) {
          if (box.length < 32) return null;
          timescale = box.readUInt32BE(20);
          duration = Number(box.readBigUInt64BE(24));
        } else {
          timescale = box.readUInt32BE(12);
          duration = box.readUInt32BE(16);
        }
      } else if (child === 'mvex') {
        for await (const [inner, innerStart] of boxes(file, childStart, childEnd)) {
          if (inner !== 'mehd') continue;
          const box = await bytesAt(file, innerStart, 12);
          if (box.length >= 8) fragments = box[0] === 1 && box.length >= 12 ? Number(box.readBigUInt64BE(4)) : box.readUInt32BE(4);
        }
      }
    }
    const length = duration || fragments;
    return timescale > 0 && length > 0 ? Math.round((length / timescale) * 1000) : null;
  }
  return null;
}

const MATROSKA_HEAD_BYTES = 4 * 1024 * 1024;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const CLUSTER = 0x1f43b675;
const TIMESTAMP_SCALE = 0x2ad7b1;
const DURATION = 0x4489;

/** An element id keeps its length marker, a size loses it. An all-ones size means "unknown" */
function vint(buffer: Buffer, at: number, keepMarker: boolean): { value: number; length: number; unknown: boolean } | null {
  if (at >= buffer.length) return null;
  const first = buffer[at];
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8 || at + length > buffer.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = (first & (0xff >> length)) === 0xff >> length;
  for (let i = 1; i < length; i += 1) {
    value = value * 256 + buffer[at + i];
    if (buffer[at + i] !== 0xff) allOnes = false;
  }
  return { value, length, unknown: allOnes };
}

/** WebM and MKV: Segment/Info holds the scale and the duration, usually within the first bytes */
async function readMatroska(file: Reader): Promise<number | null> {
  const buffer = await bytesAt(file, 0, MATROSKA_HEAD_BYTES);
  let at = 0;
  let end = buffer.length;
  while (at < end) {
    const id = vint(buffer, at, true);
    if (!id) return null;
    const size = vint(buffer, at + id.length, false);
    if (!size) return null;
    const content = at + id.length + size.length;
    if (id.value === SEGMENT) {
      at = content;
      continue;
    }
    if (id.value === CLUSTER) return null;
    if (id.value === INFO) {
      const infoEnd = Math.min(content + size.value, buffer.length);
      let scale = 1_000_000;
      let duration: number | null = null;
      let inner = content;
      while (inner < infoEnd) {
        const childId = vint(buffer, inner, true);
        if (!childId) break;
        const childSize = vint(buffer, inner + childId.length, false);
        if (!childSize) break;
        const value = inner + childId.length + childSize.length;
        if (childId.value === TIMESTAMP_SCALE) scale = buffer.readUIntBE(value, Math.min(childSize.value, 6));
        if (childId.value === DURATION) duration = childSize.value === 4 ? buffer.readFloatBE(value) : buffer.readDoubleBE(value);
        inner = value + childSize.value;
      }
      return duration && duration > 0 ? Math.round((duration * scale) / 1_000_000) : null;
    }
    if (size.unknown) return null;
    at = content + size.value;
  }
  return null;
}
