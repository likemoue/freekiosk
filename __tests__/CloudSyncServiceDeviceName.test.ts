/**
 * The heartbeat is what carries the name given on the management website, and the two ways out of
 * or into a cloud take it away with every other setting.
 */
// A module of its own: other test files declare helpers of the same name
export {};

const { NativeModules } = require('react-native');
NativeModules.HttpServerModule = {
  executeNativeCommand: jest.fn(),
  captureScreenshotBase64: jest.fn(),
};

const mockGetStatus = jest.fn();
jest.mock('../src/services/DeviceControlService', () => ({
  __esModule: true,
  default: { getStatus: (...args: any[]) => mockGetStatus(...args) },
}));

jest.mock('../src/utils/capabilities', () => ({
  getCapabilities: () => Promise.resolve([]),
}));

jest.mock('../src/utils/secureStorage', () => ({
  ...jest.requireActual('../src/utils/secureStorage'),
  getCloudCredentials: jest.fn(),
  saveCloudCredentials: jest.fn(() => Promise.resolve()),
  clearCloudCredentials: jest.fn(() => Promise.resolve()),
  clearSecurePin: jest.fn(() => Promise.resolve()),
  clearSecureApiKey: jest.fn(() => Promise.resolve()),
  clearSecureMqttPassword: jest.fn(() => Promise.resolve()),
  clearSecureBasicAuthPassword: jest.fn(() => Promise.resolve()),
}));

const AsyncStorage = require('@react-native-async-storage/async-storage');
const { CloudSyncService } = require('../src/utils/CloudSyncService');
const { DeviceDisplayName } = require('../src/utils/DeviceDisplayName');

const CREDS = { deviceId: 'dev-1', apiKey: 'fk_test', cloudUrl: 'https://cloud.test', organizationName: 'Org' };

async function heartbeatAnswering(answer: Record<string, unknown>) {
  mockGetStatus.mockResolvedValue({
    battery: { level: 80, charging: false, plugged: 'none', present: true },
    screen: { on: true, brightness: 50 },
    webview: { currentUrl: '' },
    device: { ip: '', kioskMode: true, isDeviceOwner: true, version: '2.1.0', model: 'SM-X210', manufacturer: 'samsung', androidVersion: '16', freeStorageMb: 1, freeMemoryMb: 1, uptime: 1 },
    wifi: { ssid: 'x', signalStrength: -50, connected: true, ethernet: false },
    cellular: { connected: false, carrier: '', networkType: '', signalDbm: 0, airplaneMode: false },
    timestamp: 0,
  });
  (globalThis as any).fetch = jest.fn(() =>
    Promise.resolve({ status: 200, ok: true, json: () => Promise.resolve({ config_version: 0, ...answer }) }),
  );
  await CloudSyncService.sendHeartbeat(CREDS, { force: true });
}

describe('the name in the heartbeat', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    DeviceDisplayName.forget();
  });

  afterEach(() => {
    CloudSyncService.stop();
  });

  it('is taken from the answer', async () => {
    await heartbeatAnswering({ device_name: 'Lớp 5A - Máy 1' });
    expect(await DeviceDisplayName.current()).toBe('Lớp 5A - Máy 1');
  });

  it('stays when a cloud sends none', async () => {
    await heartbeatAnswering({ device_name: 'Lớp 5A - Máy 1' });
    await heartbeatAnswering({});
    expect(await DeviceDisplayName.current()).toBe('Lớp 5A - Máy 1');
  });

  it('goes when the website removes the tablet', async () => {
    await heartbeatAnswering({ device_name: 'Lớp 5A - Máy 1' });
    await heartbeatAnswering({ force_unenroll: true, device_name: 'Lớp 5A - Máy 1' });
    expect(await DeviceDisplayName.current()).toBeNull();
    expect(await AsyncStorage.getItem('@cloud_device_display_name')).toBeNull();
  });

  it('goes when the tablet enrolls somewhere else, until that server names it', async () => {
    await heartbeatAnswering({ device_name: 'Lớp 5A - Máy 1' });
    jest.spyOn(CloudSyncService, 'start').mockResolvedValue(undefined);
    (globalThis as any).fetch = jest.fn(() =>
      Promise.resolve({ status: 201, ok: true, json: () => Promise.resolve({ device_id: 'dev-2', api_key: 'fk_2', organization_name: 'Org' }) }),
    );
    const result = await CloudSyncService.enroll('https://other.test', 'CODE', {});
    expect(result.success).toBe(true);
    expect(await DeviceDisplayName.current()).toBeNull();
  });
});
