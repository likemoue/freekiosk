import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'node:net';
import { rmSync } from 'node:fs';
import { createApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';
import { resetRateLimits } from '../src/common/rate-limit';
import { env } from '../src/config/env';

export const ADMIN = { email: 'admin@test.local', password: 'Test-Admin-Password-1', newPassword: 'Test-Admin-Password-2' };

export interface TestServer {
  app: INestApplication;
  prisma: PrismaService;
  base: string;
  close: () => Promise<void>;
}

const TABLES = [
  'ActivityLog', 'Alert', 'AlertChannel', 'ApkPackage', 'AppInfo', 'AppSetting', 'Command', 'ConfigProfile', 'Device', 'EnrollmentToken',
  'Group', 'MediaAsset', 'Playlist', 'PlaylistItem', 'ScheduleRule', 'ScheduledTask', 'Screenshot', 'Session', 'Upload', 'User',
];

export async function startServer(): Promise<TestServer> {
  rmSync(env().dataDir, { recursive: true, force: true });
  // Emptied before the app starts, so the first administrator is created again from the environment
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { PrismaClient } = await import('../src/generated/prisma/client');
  const cleaner = new PrismaClient({ adapter: new PrismaPg({ connectionString: env().databaseUrl }) });
  await cleaner.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`);
  await cleaner.$disconnect();
  resetRateLimits();

  const app = await createApp({ logger: false });
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return {
    app,
    prisma: app.get(PrismaService),
    base: `http://127.0.0.1:${port}`,
    close: () => app.close(),
  };
}

export class AdminClient {
  cookie = '';
  constructor(private readonly base: string) {}

  async request(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        'X-Requested-With': 'freekiosk-manager',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async json<T = any>(method: string, path: string, body?: unknown, expected = [200, 201]): Promise<T> {
    const response = await this.request(method, path, body);
    const text = await response.text();
    if (!expected.includes(response.status)) throw new Error(`${method} ${path}: HTTP ${response.status} ${text}`);
    return text ? (JSON.parse(text) as T) : (undefined as T);
  }

  async login(email: string, password: string, code?: string): Promise<Response> {
    const response = await this.request('POST', '/api/admin/auth/login', { email, password, code });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    return response;
  }
}

/** A signed-in administrator who has already replaced the first password */
export async function adminClient(server: TestServer): Promise<AdminClient> {
  const client = new AdminClient(server.base);
  const first = await client.login(ADMIN.email, ADMIN.password);
  if (first.ok) {
    await client.json('POST', '/api/admin/auth/password', { currentPassword: ADMIN.password, newPassword: ADMIN.newPassword });
  } else {
    await client.login(ADMIN.email, ADMIN.newPassword);
  }
  return client;
}

/** Talks like the app does: src/utils/CloudSyncService.ts and CloudCommandService.ts */
export class FakeTablet {
  deviceId = '';
  apiKey = '';
  configVersion = 0;
  constructor(private readonly base: string) {}

  async enroll(token: string, capabilities: string[] = ['brightness', 'screen', 'reload', 'screenshot', 'tts', 'toast', 'audio', 'signage_web', 'signage_youtube']) {
    const response = await fetch(`${this.base}/api/v1/devices/enroll/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token,
        device_info: { model: 'Tab A9', manufacturer: 'Samsung', android_version: '14', app_version: '2.1.0-beta.1', serial_number: '', capabilities, form_factor: 'tablet' },
      }),
    });
    const data: any = await response.json();
    if (response.ok) {
      this.deviceId = data.device_id;
      this.apiKey = data.api_key;
    }
    return { status: response.status, ok: response.ok, data };
  }

  auth() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  telemetry(extra: { level?: number; freeStorageMb?: number; playlistVersion?: string } = {}) {
    return {
      battery: { level: extra.level ?? 80, charging: false },
      network: { wifi_ssid: 'Truong-A', wifi_signal_dbm: -55, ethernet_connected: false, ip_address: '172.16.10.50', cellular_connected: false, airplane_mode: false },
      display: { screen_on: true, brightness: 70 },
      app: { current_url: 'https://example.com/', kiosk_mode: true, device_owner: true, capabilities: ['brightness', 'screen', 'reload', 'screenshot', 'tts', 'toast', 'audio', 'signage_web', 'signage_youtube', 'reboot', 'silent_install'] },
      system: {
        app_version: '2.1.0-beta.1', model: 'Tab A9', manufacturer: 'Samsung', android_version: '14', form_factor: 'tablet',
        free_storage_mb: extra.freeStorageMb ?? 12000, free_memory_mb: 1500, uptime_seconds: 3600, timezone: 'Asia/Ho_Chi_Minh', utc_offset_minutes: 420,
        ...(extra.playlistVersion !== undefined ? { signage_playlist_version: extra.playlistVersion } : {}),
      },
    };
  }

  async heartbeat(extra: Record<string, unknown> = {}, telemetry = this.telemetry()) {
    const response = await fetch(`${this.base}/api/v1/devices/${this.deviceId}/heartbeat/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth() },
      body: JSON.stringify({
        ...telemetry,
        config: { general: { url: 'https://example.com/', displayMode: 'webview' }, security: { kioskEnabled: true } },
        config_version: this.configVersion,
        config_updated_at: '2026-11-03T00:00:00.000Z',
        sensitive_config: { pin: null, mqttPassword: 'mqtt-secret', restApiKey: 'rest-secret', httpBasicAuthPassword: '' },
        ...extra,
      }),
    });
    const data: any = response.ok ? await response.json() : null;
    // What the app does with the answer
    if (data?.sync_action === 'apply' && data.config) this.configVersion = data.config_version;
    else if (data && data.config_version > this.configVersion) this.configVersion = data.config_version;
    return { status: response.status, data };
  }

  async get(path: string) {
    return fetch(`${this.base}/api/v1/devices/${this.deviceId}/${path}/`, { headers: this.auth() });
  }

  async sendResult(commandId: string, status: 'success' | 'error', result: unknown = null, error = '') {
    return fetch(`${this.base}/api/v1/commands/${commandId}/result/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this.auth() },
      body: JSON.stringify({ status, result, error_message: error }),
    });
  }
}

export async function newToken(admin: AdminClient, body: Record<string, unknown> = {}): Promise<{ id: string; token: string }> {
  return admin.json('POST', '/api/admin/enrollment/tokens', body);
}

export async function uploadInParts(admin: AdminClient, base: string, fileName: string, content: Buffer, purpose: string): Promise<string> {
  const { id } = await admin.json('POST', '/api/admin/uploads', { fileName, sizeBytes: content.length, purpose });
  const partSize = Math.ceil(content.length / 3);
  for (let offset = 0; offset < content.length; offset += partSize) {
    const response = await fetch(`${base}/api/admin/uploads/${id}/part?offset=${offset}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream', Cookie: admin.cookie, 'X-Requested-With': 'freekiosk-manager' },
      body: new Uint8Array(content.subarray(offset, offset + partSize)),
    });
    if (!response.ok) throw new Error(`part upload failed: ${response.status} ${await response.text()}`);
  }
  return id;
}
