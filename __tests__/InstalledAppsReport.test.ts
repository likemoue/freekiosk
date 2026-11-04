/**
 * What the tablet tells the management website about its apps:
 *
 *   - a heartbeat carries a hash, and the list goes only when the website asks
 *   - FreeKiosk itself is not on offer
 *   - the package list is not read at every heartbeat
 *   - a tablet that cannot read an icon says so, or it would be asked for ever
 *   - a failure stays quiet: the heartbeat must not depend on any of this
 */
// A module of its own: other test files declare helpers of the same name
export {};

const { NativeModules } = require('react-native');

const mockInstalled = jest.fn();
const mockIcon = jest.fn();
NativeModules.AppLauncherModule = {
  getInstalledApps: mockInstalled,
  getAppIcon: mockIcon,
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
NativeModules.HttpServerModule = {
  executeNativeCommand: jest.fn(),
  captureScreenshotBase64: jest.fn(),
};

jest.mock('../src/utils/capabilities', () => ({
  getCapabilities: () => Promise.resolve([]),
}));

jest.mock('../src/utils/secureStorage', () => ({
  ...jest.requireActual('../src/utils/secureStorage'),
  getCloudCredentials: jest.fn(),
}));

const mockGetStatus = jest.fn();
jest.mock('../src/services/DeviceControlService', () => ({
  __esModule: true,
  default: { getStatus: (...args: any[]) => mockGetStatus(...args) },
}));

const { InstalledAppsReport } = require('../src/utils/InstalledAppsReport');
const { CloudSyncService } = require('../src/utils/CloudSyncService');

const CREDS = { deviceId: 'dev-1', apiKey: 'fk_test', cloudUrl: 'https://cloud.test', organizationName: 'Org' };
const ICLASS = { packageName: 'ismart.edu.vn.iclass', appName: 'iCLASS', versionCode: 3 };
const CHROME = { packageName: 'com.android.chrome', appName: 'Chrome', versionCode: 700 };
const SELF = { packageName: 'com.freekiosk', appName: 'FreeKiosk', versionCode: 56 };

type Answer = Record<string, unknown>;

/** A server answering per path, remembering what it was sent */
function server(answers: Record<string, Answer | Answer[]>) {
  const calls: Array<{ path: string; auth: string; body: any }> = [];
  (globalThis as any).fetch = jest.fn((url: string, init: any) => {
    const path = url.replace(`${CREDS.cloudUrl}/api/v1/devices/${CREDS.deviceId}/`, '').replace(/\/$/, '');
    calls.push({ path, auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null });
    const planned = answers[path] ?? {};
    const answer = Array.isArray(planned) ? planned.shift() ?? {} : planned;
    if (answer.__fail) return Promise.reject(new TypeError('Network request failed'));
    return Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve(answer) });
  });
  return calls;
}

describe('InstalledAppsReport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    InstalledAppsReport.reset();
    mockInstalled.mockResolvedValue([ICLASS, SELF, CHROME]);
    mockIcon.mockImplementation((packageName: string) => Promise.resolve(`data:image/png;base64,ICON-${packageName}`));
  });

  it('gives the same hash for the same apps in any order, and another when they change', async () => {
    const first = await InstalledAppsReport.hash();
    expect(first).toMatch(/^[0-9a-f]{16}$/);

    InstalledAppsReport.reset();
    mockInstalled.mockResolvedValue([CHROME, SELF, ICLASS]);
    expect(await InstalledAppsReport.hash()).toBe(first);

    InstalledAppsReport.reset();
    mockInstalled.mockResolvedValue([ICLASS, CHROME]);
    expect(await InstalledAppsReport.hash()).toBe(first);

    InstalledAppsReport.reset();
    mockInstalled.mockResolvedValue([ICLASS, { ...CHROME, versionCode: 701 }]);
    expect(await InstalledAppsReport.hash()).not.toBe(first);
  });

  it('reads the package list every few minutes, not at every heartbeat', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await InstalledAppsReport.hash();
    now.mockReturnValue(1_000_000 + 30_000);
    await InstalledAppsReport.hash();
    expect(mockInstalled).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1_000_000 + 5 * 60_000);
    await InstalledAppsReport.hash();
    expect(mockInstalled).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('has no hash when the list cannot be read', async () => {
    mockInstalled.mockRejectedValue(new Error('no'));
    expect(await InstalledAppsReport.hash()).toBeUndefined();
    mockInstalled.mockResolvedValue(null);
    expect(await InstalledAppsReport.hash()).toBeUndefined();
  });

  it('sends nothing unless asked', async () => {
    await InstalledAppsReport.hash();
    const calls = server({});
    await InstalledAppsReport.answer(CREDS, false, []);
    await InstalledAppsReport.answer(CREDS, undefined, undefined);
    expect(calls).toEqual([]);
  });

  it('sends the list, without FreeKiosk, then the icons in the rounds the server asks for', async () => {
    const hash = await InstalledAppsReport.hash();
    const calls = server({
      apps: { icons_wanted: ['ismart.edu.vn.iclass'] },
      'app-icons': [{ icons_wanted: ['com.android.chrome'] }, { icons_wanted: [] }],
    });

    await InstalledAppsReport.answer(CREDS, true, []);

    expect(calls.map((call) => call.path)).toEqual(['apps', 'app-icons', 'app-icons']);
    expect(calls[0].auth).toBe('Bearer fk_test');
    expect(calls[0].body.hash).toBe(hash);
    expect(calls[0].body.apps).toEqual([
      { package: 'com.android.chrome', label: 'Chrome', version_code: 700 },
      { package: 'ismart.edu.vn.iclass', label: 'iCLASS', version_code: 3 },
    ]);
    // The server wants the image, not the address form the app's own screen uses
    expect(calls[1].body.icons).toEqual([{ package: 'ismart.edu.vn.iclass', png_base64: 'ICON-ismart.edu.vn.iclass' }]);
    expect(calls[2].body.icons).toEqual([{ package: 'com.android.chrome', png_base64: 'ICON-com.android.chrome' }]);
  });

  it('picks up icons a heartbeat asks for, without sending the list again', async () => {
    await InstalledAppsReport.hash();
    const calls = server({ 'app-icons': { icons_wanted: [] } });
    await InstalledAppsReport.answer(CREDS, false, ['com.android.chrome']);
    expect(calls.map((call) => call.path)).toEqual(['app-icons']);
  });

  it('says so when it cannot read an icon', async () => {
    await InstalledAppsReport.hash();
    mockIcon.mockRejectedValue(new Error('APP_NOT_FOUND'));
    const calls = server({ 'app-icons': { icons_wanted: [] } });
    await InstalledAppsReport.answer(CREDS, false, ['com.android.chrome']);
    expect(calls[0].body.icons).toEqual([{ package: 'com.android.chrome', png_base64: null }]);
  });

  it('stops when a round fails, and can answer again later', async () => {
    await InstalledAppsReport.hash();
    const calls = server({ apps: { __fail: true } });
    await expect(InstalledAppsReport.answer(CREDS, true, [])).rejects.toThrow('Network request failed');
    expect(calls).toHaveLength(1);

    server({ apps: { icons_wanted: [] } });
    await expect(InstalledAppsReport.answer(CREDS, true, [])).resolves.toBeUndefined();
  });

  it('does not answer twice at once', async () => {
    await InstalledAppsReport.hash();
    const calls = server({ apps: { icons_wanted: [] } });
    await Promise.all([InstalledAppsReport.answer(CREDS, true, []), InstalledAppsReport.answer(CREDS, true, [])]);
    expect(calls).toHaveLength(1);
  });
});

describe('the heartbeat and the report', () => {
  const STATUS = {
    battery: { level: 80, charging: false, plugged: 'none', present: true },
    screen: { on: true, brightness: 50 },
    webview: { currentUrl: '' },
    device: { ip: '', kioskMode: true, isDeviceOwner: true, version: '2.1.0', model: 'SM-X210', manufacturer: 'samsung', androidVersion: '16', freeStorageMb: 1, freeMemoryMb: 1, uptime: 1 },
    wifi: { ssid: 'x', signalStrength: -50, connected: true, ethernet: false },
    cellular: { connected: false, carrier: '', networkType: '', signalDbm: 0, airplaneMode: false },
    timestamp: 0,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    InstalledAppsReport.reset();
    mockGetStatus.mockResolvedValue(STATUS);
    mockInstalled.mockResolvedValue([ICLASS]);
    mockIcon.mockResolvedValue('data:image/png;base64,AAAA');
  });

  const flush = () => new Promise<void>((done) => setTimeout(() => done(), 20));

  it('carries the hash, and answers what the website asks for', async () => {
    const calls = server({
      heartbeat: { config_version: 0, installed_apps_wanted: true, app_icons_wanted: [] },
      apps: { icons_wanted: [] },
    });
    await CloudSyncService.sendHeartbeat(CREDS, { force: true });
    await flush();
    expect(calls[0].path).toBe('heartbeat');
    expect(calls[0].body.installed_apps_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(calls.map((call) => call.path)).toEqual(['heartbeat', 'apps']);
  });

  it('sends nothing more to a cloud that does not ask', async () => {
    const calls = server({ heartbeat: { config_version: 0 } });
    await CloudSyncService.sendHeartbeat(CREDS, { force: true });
    await flush();
    expect(calls.map((call) => call.path)).toEqual(['heartbeat']);
  });

  it('still beats when the list cannot be read', async () => {
    mockInstalled.mockRejectedValue(new Error('no'));
    const calls = server({ heartbeat: { config_version: 0 } });
    await CloudSyncService.sendHeartbeat(CREDS, { force: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.installed_apps_hash).toBeUndefined();
  });

  it('is not held up or broken by a report that fails', async () => {
    const calls = server({ heartbeat: { config_version: 0, installed_apps_wanted: true }, apps: { __fail: true } });
    await expect(CloudSyncService.sendHeartbeat(CREDS, { force: true })).resolves.toBeUndefined();
    await flush();
    expect(calls.map((call) => call.path)).toEqual(['heartbeat', 'apps']);
  });
});
