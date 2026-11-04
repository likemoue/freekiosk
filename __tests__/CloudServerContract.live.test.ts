/**
 * The real code of the app against the real management server in cloud/: enrollment, heartbeat,
 * configuration, commands, APK channel, digital signage and leaving. Only the native layer is
 * replaced. Skipped unless a server is named, so a plain `npm test` needs nothing running:
 *
 *   FREEKIOSK_LIVE_URL=http://localhost:8090 FREEKIOSK_LIVE_EMAIL=... FREEKIOSK_LIVE_PASSWORD=... \
 *     npx jest __tests__/CloudServerContract.live.test.ts
 */
export {};

const liveEnv: Record<string, string | undefined> = (globalThis as any).process.env;
const BASE = liveEnv.FREEKIOSK_LIVE_URL;
const EMAIL = liveEnv.FREEKIOSK_LIVE_EMAIL ?? '';
const PASSWORD = liveEnv.FREEKIOSK_LIVE_PASSWORD ?? '';

const mockKeychain = new Map<string, { username: string; password: string }>();
jest.mock('react-native-keychain', () => ({
  setGenericPassword: jest.fn((username: string, password: string, options?: { service?: string }) => {
    mockKeychain.set(options?.service ?? 'default', { username, password });
    return Promise.resolve(true);
  }),
  getGenericPassword: jest.fn((options?: { service?: string }) => Promise.resolve(mockKeychain.get(options?.service ?? 'default') ?? false)),
  resetGenericPassword: jest.fn((options?: { service?: string }) => {
    mockKeychain.delete(options?.service ?? 'default');
    return Promise.resolve(true);
  }),
  ACCESSIBLE: { WHEN_UNLOCKED: 'WHEN_UNLOCKED' },
  ACCESS_CONTROL: {},
}));

const { NativeModules, DeviceEventEmitter } = require('react-native');
const mockNativeCommand = jest.fn((_command: string, _params: string) => Promise.resolve(JSON.stringify({ ok: true })));
NativeModules.HttpServerModule = {
  executeNativeCommand: mockNativeCommand,
  captureScreenshotBase64: jest.fn(() => Promise.resolve('')),
};
NativeModules.WifiControlModule = {
  saveNetworkForLater: jest.fn((ssid: string) => Promise.resolve({ ssid, secured: true })),
};

const mockStatus = {
  battery: { level: 64, charging: true, plugged: 'usb', present: true },
  screen: { on: true, brightness: 55 },
  webview: { currentUrl: 'https://ban-dau.example/' },
  device: {
    ip: '172.16.15.99', kioskMode: true, isDeviceOwner: true, version: '2.1.0-beta.1', model: 'SM-X210',
    manufacturer: 'Samsung', androidVersion: '16', freeStorageMb: 32000, freeMemoryMb: 1500, uptime: 7200,
  },
  wifi: { ssid: 'iSMART-Staff', signalStrength: -51, connected: true, ethernet: false },
  cellular: { connected: false, carrier: '', networkType: '', signalDbm: 0, airplaneMode: false },
  timestamp: 0,
};
jest.mock('../src/services/DeviceControlService', () => ({
  __esModule: true,
  default: { getStatus: () => Promise.resolve(mockStatus) },
}));

// A real PNG: the server keeps nothing else
const ICON = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==';
NativeModules.AppLauncherModule = {
  getInstalledApps: jest.fn(() => Promise.resolve([
    { packageName: 'com.freekiosk', appName: 'FreeKiosk', versionCode: 56 },
    { packageName: 'ismart.edu.vn.iclass', appName: 'iCLASS', versionCode: 3 },
    { packageName: 'com.android.chrome', appName: 'Chrome', versionCode: 700 },
  ])),
  getAppIcon: jest.fn(() => Promise.resolve(`data:image/png;base64,${ICON}`)),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};

jest.mock('../src/utils/capabilities', () => ({
  getCapabilities: () => Promise.resolve(['brightness', 'screen', 'reload', 'screenshot', 'toast', 'tts', 'audio', 'signage_web', 'signage_youtube', 'device_owner', 'reboot', 'silent_install']),
}));

const mockDownloads: Array<{ url: string; status: number; bytes: number }> = [];
jest.mock('../src/utils/ManagedAppInstaller', () => ({
  __esModule: true,
  default: {
    // What the native installer does before installing: download with the device key
    installFromUrl: async (url: string, token: string) => {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      mockDownloads.push({ url, status: response.status, bytes: (await response.arrayBuffer()).byteLength });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { status: 'success' };
    },
  },
}));

const { CloudSyncService, CONFIG_UPDATED_EVENT } = require('../src/utils/CloudSyncService');
const { CloudCommandService } = require('../src/utils/CloudCommandService');
const { SignagePlaylist } = require('../src/utils/SignagePlaylist');
const { StorageService } = require('../src/utils/storage');
const { getCloudCredentials, verifySecurePin } = require('../src/utils/secureStorage');
const { findLatestUpdate, installFromServer } = require('../src/utils/AppUpdateCheck');
const { DeviceDisplayName } = require('../src/utils/DeviceDisplayName');

let cookie = '';

async function admin<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'freekiosk-manager', Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

const settle = () => new Promise<void>((done) => setTimeout(() => done(), 400));
const beat = async () => {
  const creds = await getCloudCredentials();
  await CloudSyncService.sendHeartbeat(creds, { force: true });
  await settle();
};
const INFO = { model: 'SM-X210', manufacturer: 'Samsung', android_version: '16', app_version: '2.1.0-beta.1', serial_number: '' };

(BASE ? describe : describe.skip)('the app against the real management server', () => {
  let deviceId = '';

  beforeAll(async () => {
    await admin('POST', '/api/admin/auth/login', { email: EMAIL, password: PASSWORD });
  });

  afterAll(async () => {
    CloudSyncService.stop();
    if (deviceId) await admin('DELETE', `/api/admin/devices/${deviceId}`).catch(() => {});
  });

  it('refuses a wrong code, with the reason of the server in the words the app shows', async () => {
    const result = await CloudSyncService.enroll(BASE, 'KHONGCOTHAT', INFO);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/không hợp lệ/);
    expect(await CloudSyncService.isEnrolled()).toBe(false);
  });

  it('enrolls with a code, and appears in the dashboard with its telemetry', async () => {
    const { token } = await admin('POST', '/api/admin/enrollment/tokens', { label: 'Live test' });
    const result = await CloudSyncService.enroll(BASE, token, INFO);
    expect(result).toMatchObject({ success: true, organizationName: expect.any(String) });
    CloudSyncService.stop();

    const creds = await getCloudCredentials();
    expect(creds.cloudUrl).toBe(BASE);
    deviceId = creds.deviceId;

    const device = await admin('GET', `/api/admin/devices/${deviceId}`);
    expect(device).toMatchObject({
      online: true,
      batteryLevel: 64,
      batteryCharging: true,
      wifiSsid: 'iSMART-Staff',
      wifiSignalDbm: -51,
      ipAddress: '172.16.15.99',
      brightness: 55,
      currentUrl: 'https://ban-dau.example/',
      deviceOwner: true,
      model: 'SM-X210',
      appVersion: '2.1.0-beta.1',
      formFactor: 'tablet',
    });
    expect(device.capabilities).toContain('reboot');

    // The configuration of the app is kept as a backup, in the structure it has on the tablet
    const config = await admin('GET', `/api/admin/devices/${deviceId}/config`);
    expect(config.reported.general.displayMode).toBe('webview');
  });

  it('applies a change made in the dashboard, secret included, then settles', async () => {
    const updated = jest.fn();
    const subscription = DeviceEventEmitter.addListener(CONFIG_UPDATED_EVENT, updated);

    await admin('PATCH', `/api/admin/devices/${deviceId}/config`, {
      config: { general: { url: 'https://truong-a.edu.vn/' }, display: { defaultBrightness: 0.3 } },
      sensitive: { pin: '4321' },
    });
    expect((await admin('GET', `/api/admin/devices/${deviceId}`)).configPending).toBe(true);

    await beat();
    expect(await StorageService.getUrl()).toBe('https://truong-a.edu.vn/');
    expect(updated).toHaveBeenCalledTimes(1);
    expect((await verifySecurePin('4321')).success).toBe(true);
    const version = await StorageService.getConfigVersion();
    expect(version).toBeGreaterThan(0);

    // The next beat tells the server the device has it, and nothing more comes
    await beat();
    expect(updated).toHaveBeenCalledTimes(1);
    expect((await admin('GET', `/api/admin/devices/${deviceId}`)).configPending).toBe(false);
    const config = await admin('GET', `/api/admin/devices/${deviceId}/config`);
    expect(config.reported.general.url).toBe('https://truong-a.edu.vn/');
    expect(config.reported.display.defaultBrightness).toBe(0.3);
    subscription.remove();
  });

  it('keeps a setting changed on the tablet, even with a change from the dashboard on its way', async () => {
    await StorageService.saveAutoReload(true);
    await admin('PATCH', `/api/admin/devices/${deviceId}/config`, { config: { general: { url: 'https://truong-b.edu.vn/' } } });
    await beat();
    expect(await StorageService.getUrl()).toBe('https://truong-b.edu.vn/');
    expect(await StorageService.getAutoReload()).toBe(true);
  });

  it('runs a command at the next heartbeat and reports the result', async () => {
    mockNativeCommand.mockClear();
    await admin('POST', '/api/admin/commands', { type: 'toast', params: { message: 'Xin chào' }, target: { deviceIds: [deviceId] } });
    await beat();
    await CloudCommandService.poll(await getCloudCredentials());
    expect(mockNativeCommand).toHaveBeenCalledWith('toast', JSON.stringify({ text: 'Xin chào' }));

    const history = await admin('GET', `/api/admin/commands?deviceId=${deviceId}`);
    expect(history[0]).toMatchObject({ type: 'toast', status: 'SUCCESS' });
  });

  it('reports a command it cannot run as an error, in words the dashboard can show', async () => {
    mockNativeCommand.mockClear();
    await admin('POST', '/api/admin/commands', { type: 'add_wifi_network', params: { ssid: 'Truong-C', password: 'bi-mat' }, target: { deviceIds: [deviceId] } });
    await beat();
    await CloudCommandService.poll(await getCloudCredentials());
    expect(NativeModules.WifiControlModule.saveNetworkForLater).toHaveBeenCalledWith('Truong-C', 'bi-mat');
    const history = await admin('GET', `/api/admin/commands?deviceId=${deviceId}`);
    expect(history[0]).toMatchObject({ type: 'add_wifi_network', status: 'SUCCESS' });
    expect(JSON.stringify(history)).not.toContain('bi-mat');
  });

  it('plays a playlist: every item passes the checks of the app, and the mode follows', async () => {
    expect(await StorageService.getDisplayMode()).toBe('webview');
    const playlist = await admin('POST', '/api/admin/signage/playlists', { name: 'Thử trực tiếp' });
    await admin('PUT', `/api/admin/signage/playlists/${playlist.id}/items`, {
      items: [
        { kind: 'video', url: 'https://cdn.example/a.mp4', title: 'Video' },
        { kind: 'image', url: 'https://cdn.example/b.jpg', durationSeconds: 12 },
        { kind: 'web', url: 'https://example.com/lich' },
        { kind: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' },
      ],
    });
    await admin('PUT', `/api/admin/signage/playlists/${playlist.id}/assign`, { deviceIds: [deviceId], groupIds: [] });

    await beat();
    const active = await SignagePlaylist.getActive();
    expect(active?.name).toBe('Thử trực tiếp');
    expect(active?.items.map((i: any) => i.type)).toEqual(['video', 'image', 'web', 'youtube']);
    expect(active?.items[1].duration).toBe(12);
    expect(active?.items[2].duration).toBe(30);
    expect(active?.items[3].videoId).toBe('dQw4w9WgXcQ');
    expect(await StorageService.getDisplayMode()).toBe('media_player');

    // The screen says what it plays, and the dashboard agrees
    await beat();
    expect((await admin('GET', `/api/admin/devices/${deviceId}`)).signage.state).toBe('up_to_date');

    // A schedule rule, read by the app with its own clock logic
    const evening = await admin('POST', '/api/admin/signage/playlists', { name: 'Buổi tối' });
    await admin('PUT', `/api/admin/signage/playlists/${evening.id}/items`, { items: [{ kind: 'image', url: 'https://cdn.example/toi.jpg' }] });
    await admin('POST', '/api/admin/signage/rules', { playlistId: evening.id, deviceId, days: [1, 2, 3, 4, 5, 6, 7], start: '18:00', end: '22:00' });
    await beat();
    const at = (hour: number) => new Date(2026, 10, 3, hour, 30);
    expect((await SignagePlaylist.getActive(at(19)))?.name).toBe('Buổi tối');
    expect((await SignagePlaylist.getActive(at(10)))?.name).toBe('Thử trực tiếp');

    // Removed: the tablet goes back to what it was showing
    await admin('PUT', `/api/admin/signage/playlists/${playlist.id}/assign`, { deviceIds: [], groupIds: [] });
    await admin('DELETE', `/api/admin/signage/playlists/${evening.id}`);
    await beat();
    expect(await SignagePlaylist.getActive()).toBeNull();
    expect(await StorageService.getDisplayMode()).toBe('webview');
    await admin('DELETE', `/api/admin/signage/playlists/${playlist.id}`);
  });

  it('takes the name given in the dashboard, at the next heartbeat', async () => {
    await admin('PATCH', `/api/admin/devices/${deviceId}`, { name: 'Lớp 5A - Máy 1' });
    await beat();
    expect(await DeviceDisplayName.current()).toBe('Lớp 5A - Máy 1');
  });

  it('reports its apps when asked, and the picker of the website can then put one on its screen', async () => {
    await beat();
    await settle();

    const target = { deviceIds: [deviceId] };
    const { apps, notReporting } = await admin('POST', '/api/admin/home-apps/preview', { target });
    expect(notReporting).toBe(0);
    const chrome = apps.find((app: any) => app.packageName === 'com.android.chrome');
    expect(chrome).toMatchObject({ label: 'Chrome', installed: 1, onHome: 0 });
    expect(chrome.iconUrl).toMatch(/com\.android\.chrome/);
    expect(apps.some((app: any) => app.packageName === 'com.freekiosk')).toBe(false);

    const icon = await fetch(`${BASE}${chrome.iconUrl}`, { headers: { Cookie: cookie } });
    expect(icon.status).toBe(200);
    expect(icon.headers.get('content-type')).toBe('image/png');

    const result = await admin('POST', '/api/admin/home-apps/apply', { target, add: ['com.android.chrome'] });
    expect(result.sent).toBe(1);
    await beat();
    const saved = await StorageService.getManagedApps();
    expect(saved).toEqual([expect.objectContaining({ packageName: 'com.android.chrome', displayName: 'Chrome', showOnHomeScreen: true })]);
  });

  it('finds the newest FreeKiosk uploaded, and downloads it the way the installer does', async () => {
    const apks = await admin<any[]>('GET', '/api/admin/apks');
    const own = apks
      .filter((apk) => apk.packageName === 'com.freekiosk' && apk.versionCode != null)
      .sort((a, b) => b.versionCode - a.versionCode);

    const update = await findLatestUpdate(false);
    if (!own.length) {
      expect(update).toBeNull();
      return;
    }
    expect(update).toMatchObject({ version: own[0].versionName, versionCode: own[0].versionCode, fromServer: true });

    await installFromServer(update);
    const download = mockDownloads[mockDownloads.length - 1];
    expect(download.status).toBe(200);
    expect(download.bytes).toBe(Number(own[0].sizeBytes));
  });

  it('leaves when told to: credentials and settings go', async () => {
    await admin('POST', `/api/admin/devices/${deviceId}/unenroll`);
    await beat();
    expect(await getCloudCredentials()).toBeNull();
    expect((await admin('GET', `/api/admin/devices/${deviceId}`)).unenrolledAt).toBeTruthy();
  });
});
