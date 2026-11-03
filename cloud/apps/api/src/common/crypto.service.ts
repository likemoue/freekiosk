import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  hkdfSync,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';
import { env } from '../config/env';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// OWASP's alternative for scrypt: N=2^16, r=8, p=2 (about 64 MiB per hash)
const SCRYPT = { N: 2 ** 16, r: 8, p: 2, maxmem: 256 * 1024 * 1024 };
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

// No 0/O, 1/I/L, or U: read aloud or typed with a TV remote, these are what goes wrong
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/** An enrollment code: short enough to type, and limited by its expiry, single use and rate limit */
export function enrollmentCode(length = 8): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

export function deepMerge(base: unknown, overlay: unknown): Record<string, unknown> {
  const isObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
  const out: Record<string, unknown> = isObject(base) ? { ...base } : {};
  if (!isObject(overlay)) return out;
  for (const [key, value] of Object.entries(overlay)) {
    out[key] = isObject(value) && isObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out;
}

function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** RFC 6238 with the parameters every authenticator app expects: SHA-1, 6 digits, 30 seconds */
export function totpCode(secret: string, timeMs: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timeMs / 30_000)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

@Injectable()
export class CryptoService {
  private readonly encKey = Buffer.from(hkdfSync('sha256', env().appSecret, 'freekiosk-manager', 'enc-v1', 32));
  private readonly macKey = Buffer.from(hkdfSync('sha256', env().appSecret, 'freekiosk-manager', 'mac-v1', 32));

  /** AES-256-GCM, stored as v1.<iv>.<tag>.<ciphertext> */
  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, data] = stored.split('.');
    if (version !== 'v1' || !iv || !tag || data === undefined) throw new Error('Unknown cipher format');
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T = Record<string, unknown>>(stored: string | null | undefined): T | null {
    if (!stored) return null;
    try {
      return JSON.parse(this.decrypt(stored)) as T;
    } catch {
      return null;
    }
  }

  /** A short capability that names one resource, usable in a URL */
  sign(purpose: string, value: string): string {
    return createHmac('sha256', this.macKey).update(`${purpose}:${value}`).digest('base64url').slice(0, 32);
  }

  verify(purpose: string, value: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(purpose, value));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = await scrypt(password, salt, 32, SCRYPT);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
  }

  async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, N, r, p, salt, hash] = stored.split('$');
    if (scheme !== 'scrypt' || !salt || !hash) return false;
    const expected = Buffer.from(hash, 'base64url');
    const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    return timingSafeEqual(actual, expected);
  }

  newTotpSecret(): string {
    return base32Encode(randomBytes(20));
  }

  /** Accepts the previous and next period too, for a clock that is a little off */
  verifyTotp(secret: string, code: string, now = Date.now()): boolean {
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) return false;
    return [-1, 0, 1].some((step) => totpCode(secret, now + step * 30_000) === clean);
  }
}
