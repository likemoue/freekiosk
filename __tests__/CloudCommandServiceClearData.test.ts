/**
 * Clearing the data of apps from the website: it reaches Android with what was chosen and no more, says
 * how each app went, and stays out of what the local REST API and MQTT can drive.
 */
export {};

const { NativeModules, Platform } = require('react-native');
const kiosk = { clearAppData: jest.fn(), isDeviceOwner: jest.fn(), hasUsageStatsPermission: jest.fn() };
const nativeHttp = { executeNativeCommand: jest.fn(), captureScreenshotBase64: jest.fn() };
NativeModules.KioskModule = kiosk;
NativeModules.HttpServerModule = nativeHttp;

jest.mock('../src/utils/secureStorage', () => ({
  ...jest.requireActual('../src/utils/secureStorage'),
  getCloudCredentials: jest.fn(() =>
    Promise.resolve({ deviceId: 'dev-1', apiKey: 'fk_test', cloudUrl: 'https://cloud.test', organizationName: 'Test Org' }),
  ),
}));

const { CloudCommandService } = require('../src/utils/CloudCommandService');
const { getCapabilities } = require('../src/utils/capabilities');
const { StorageService } = require('../src/utils/storage');

function deliver(id: string, params: Record<string, unknown>) {
  const reported: any[] = [];
  (globalThis as any).fetch = jest.fn(async (url: any, init: any) => {
    const u = String(url);
    if (u.includes('/updates/')) return { ok: true, status: 200, json: async () => [] };
    if (u.includes('/result/')) {
      reported.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => ({ commands: [{ id, type: 'clear_app_data', params, created_at: '', expires_at: '' }] }) };
  });
  return reported;
}

const nothing = { cleared: [], missing: [], failed: [], permissionsLost: [] };

beforeEach(async () => {
  jest.clearAllMocks();
  await StorageService.savePendingReports([]);
  await StorageService.saveInflightCommand(null);
});

describe('clearing the data of apps', () => {
  it('names the apps chosen, and says how each went', async () => {
    const outcome = { ...nothing, cleared: ['vn.iclass'], missing: ['vn.ipro'] };
    kiosk.clearAppData.mockResolvedValue(outcome);
    const reported = deliver('clear-1', { packages: ['vn.iclass', 'vn.ipro'], labels: ['iCLASS', 'iSMART Pro'] });
    await CloudCommandService.poll();

    expect(kiosk.clearAppData).toHaveBeenCalledWith(['vn.iclass', 'vn.ipro']);
    expect(reported).toEqual([{ status: 'success', result: outcome, error_message: '' }]);
  });

  it('never touches FreeKiosk itself, whatever it is asked', async () => {
    kiosk.clearAppData.mockResolvedValue(nothing);
    deliver('clear-2', { packages: ['com.freekiosk', 'vn.iclass'] });
    await CloudCommandService.poll();
    expect(kiosk.clearAppData).toHaveBeenCalledWith(['vn.iclass']);
  });

  it.each([[{}], [{ packages: [] }], [{ packages: 'vn.iclass' }], [{ packages: ['com.freekiosk'] }], [{ packages: [7] }]])('does nothing with no app to clear: %j', async (params) => {
    const reported = deliver(`clear-none-${JSON.stringify(params)}`, params);
    await CloudCommandService.poll();
    expect(kiosk.clearAppData).not.toHaveBeenCalled();
    expect(reported[0].status).toBe('error');
  });

  it('says what Android refused, and what it did clear', async () => {
    const outcome = { ...nothing, cleared: ['vn.iclass'], failed: ['vn.protected'] };
    kiosk.clearAppData.mockResolvedValue(outcome);
    const reported = deliver('clear-3', { packages: ['vn.iclass', 'vn.protected'] });
    await CloudCommandService.poll();
    expect(reported).toEqual([{ status: 'error', result: outcome, error_message: 'Could not clear the data of vn.protected' }]);
  });

  it('reports the refusal of a tablet that is not Device Owner', async () => {
    kiosk.clearAppData.mockRejectedValue(new Error('Clearing app data requires Device Owner mode'));
    const reported = deliver('clear-4', { packages: ['vn.iclass'] });
    await CloudCommandService.poll();
    expect(reported[0].error_message).toBe('Clearing app data requires Device Owner mode');
  });

  it('does not go through the action layer the LAN can reach', async () => {
    kiosk.clearAppData.mockResolvedValue(nothing);
    deliver('clear-5', { packages: ['vn.iclass'] });
    await CloudCommandService.poll();
    expect(nativeHttp.executeNativeCommand).not.toHaveBeenCalled();
  });
});

describe('saying it can clear data', () => {
  const version = Object.getOwnPropertyDescriptor(Platform, 'Version');
  const onAndroid = (sdk: number) => {
    Platform.OS = 'android';
    Object.defineProperty(Platform, 'Version', { configurable: true, get: () => sdk });
  };
  afterEach(() => {
    if (version) Object.defineProperty(Platform, 'Version', version);
    Platform.OS = 'ios';
  });

  it('only as a Device Owner', async () => {
    onAndroid(35);
    kiosk.isDeviceOwner.mockResolvedValue(false);
    expect(await getCapabilities()).not.toContain('clear_app_data');
    kiosk.isDeviceOwner.mockResolvedValue(true);
    expect(await getCapabilities()).toContain('clear_app_data');
  });

  it('only from Android 9', async () => {
    kiosk.isDeviceOwner.mockResolvedValue(true);
    onAndroid(27);
    expect(await getCapabilities()).not.toContain('clear_app_data');
    onAndroid(28);
    expect(await getCapabilities()).toContain('clear_app_data');
  });
});
