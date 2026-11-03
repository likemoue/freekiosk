import { resolve } from 'node:path';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Thiếu biến môi trường ${name}. Xem cloud/.env.example`);
  return value;
}

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function publicUrl(): string {
  const url = required('PUBLIC_URL').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+(\/[^\s]*)?$/.test(url)) {
    throw new Error('PUBLIC_URL phải có dạng https://kiosk.example.com');
  }
  return url;
}

function appSecret(): string {
  const secret = required('APP_SECRET');
  if (secret.length < 32) throw new Error('APP_SECRET phải dài ít nhất 32 ký tự');
  return secret;
}

export interface Env {
  production: boolean;
  port: number;
  databaseUrl: string;
  publicUrl: string;
  appSecret: string;
  dataDir: string;
  adminEmail: string | null;
  adminPassword: string | null;
  orgName: string;
  cookieSecure: boolean;
  trustCloudflareHeader: boolean;
  sessionDays: number;
  enrollmentTokenHours: number;
  mediaQuotaGb: number;
}

let cached: Env | null = null;

export function env(): Env {
  if (cached) return cached;
  const url = publicUrl();
  cached = {
    production: process.env.NODE_ENV === 'production',
    port: Number(process.env.API_PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    publicUrl: url,
    appSecret: appSecret(),
    dataDir: resolve(process.env.DATA_DIR ?? './data'),
    adminEmail: process.env.ADMIN_EMAIL?.trim().toLowerCase() || null,
    adminPassword: process.env.ADMIN_PASSWORD || null,
    orgName: process.env.ORG_NAME?.trim() || 'Tổ chức của tôi',
    cookieSecure: flag('COOKIE_SECURE', url.startsWith('https://')),
    trustCloudflareHeader: flag('TRUST_CF_HEADER', true),
    sessionDays: Number(process.env.SESSION_DAYS ?? 7),
    enrollmentTokenHours: Number(process.env.ENROLLMENT_TOKEN_HOURS ?? 24),
    mediaQuotaGb: Number(process.env.MEDIA_QUOTA_GB ?? 20),
  };
  return cached;
}

/** Tests build several apps in one process with different settings */
export function resetEnvCache(): void {
  cached = null;
}
