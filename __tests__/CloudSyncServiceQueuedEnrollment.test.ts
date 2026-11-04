/**
 * An enrollment queued over ADB or by the setup-wizard QR.
 *
 *   - the log lines are read by the USB install tool (scripts/cai-tablet-usb/Installer.cs):
 *     changing one means changing the tool, or it waits for a line that never comes
 *   - a token queued on a tablet that is already enrolled is dropped, or it would enroll
 *     the tablet again the moment an administrator removes it
 *   - the device says what it is, so the website can name it after its model
 */
// A module of its own: other test files declare helpers of the same name, and without this
// they would collide in TypeScript's shared script scope.
export {};

const { NativeModules, Platform } = require('react-native');
NativeModules.HttpServerModule = {
  executeNativeCommand: jest.fn(),
  captureScreenshotBase64: jest.fn(),
};

const mockGetCloudCredentials = jest.fn();
jest.mock('../src/utils/secureStorage', () => ({
  ...jest.requireActual('../src/utils/secureStorage'),
  getCloudCredentials: (...args: any[]) => mockGetCloudCredentials(...args),
  saveCloudCredentials: jest.fn(() => Promise.resolve()),
  clearSecurePin: jest.fn(() => Promise.resolve()),
  clearSecureApiKey: jest.fn(() => Promise.resolve()),
  clearSecureMqttPassword: jest.fn(() => Promise.resolve()),
  clearSecureBasicAuthPassword: jest.fn(() => Promise.resolve()),
}));

jest.mock('../src/utils/capabilities', () => ({
  getCapabilities: () => Promise.resolve([]),
}));

// Before the require: ./KioskModule keeps the object it finds at load time
const KioskModule = {
  getPendingCloudEnrollment: jest.fn(),
  clearPendingCloudEnrollment: jest.fn(),
  setDefaultLauncherMode: jest.fn(),
};
NativeModules.KioskModule = KioskModule;

const { CloudSyncService, enrollmentDeviceInfo } = require('../src/utils/CloudSyncService');

const CREDS = { deviceId: 'dev-1', apiKey: 'fk_test', cloudUrl: 'https://cloud.test', organizationName: 'Test Org' };
const QUEUED = { enroll_token: 'ABCD2345', cloud_url: 'https://cloud.test', org_id: '' };

function installFetch(status: number, body: object | 'network-error') {
  const fetchMock = jest.fn((_url: string, _init?: any) =>
    body === 'network-error'
      ? Promise.reject(new TypeError('Network request failed'))
      : Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) }),
  );
  (globalThis as any).fetch = fetchMock;
  return fetchMock;
}

describe('CloudSyncService queued enrollment', () => {
  let log: jest.SpyInstance;
  let warn: jest.SpyInstance;

  const logged = (spy: jest.SpyInstance) => spy.mock.calls.map(args => String(args[0]));

  beforeEach(() => {
    jest.useFakeTimers();
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(CloudSyncService, 'start').mockResolvedValue(undefined);
    KioskModule.getPendingCloudEnrollment.mockReset().mockResolvedValue(QUEUED);
    KioskModule.clearPendingCloudEnrollment.mockReset().mockResolvedValue(true);
    KioskModule.setDefaultLauncherMode.mockReset().mockResolvedValue(true);
    mockGetCloudCredentials.mockReset();
    mockGetCloudCredentials.mockResolvedValue(null);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('says so when the website accepts it', async () => {
    installFetch(200, { device_id: 'dev-1', api_key: 'fkd_x', organization_name: 'Org' });

    await CloudSyncService.consumePendingProvisioningEnrollment();

    expect(logged(log)).toContain('[CloudSync] Queued enrollment accepted');
    expect(KioskModule.clearPendingCloudEnrollment).toHaveBeenCalled();
  });

  it('says why when the website refuses it, and drops the token', async () => {
    installFetch(400, { error: 'Mã đăng ký đã hết hạn' });

    await CloudSyncService.consumePendingProvisioningEnrollment();

    expect(logged(warn)).toContain('[CloudSync] Queued enrollment refused: Mã đăng ký đã hết hạn');
    expect(KioskModule.clearPendingCloudEnrollment).toHaveBeenCalled();
  });

  it('says so when the website cannot be reached, and keeps the token for the retry', async () => {
    installFetch(0, 'network-error');

    await CloudSyncService.consumePendingProvisioningEnrollment();

    expect(logged(warn)).toContain('[CloudSync] Queued enrollment could not reach the server, will retry');
    expect(KioskModule.clearPendingCloudEnrollment).not.toHaveBeenCalled();
  });

  it('drops a token queued on a tablet that is already enrolled, without using it', async () => {
    mockGetCloudCredentials.mockResolvedValue(CREDS);
    const fetchMock = installFetch(200, {});

    await CloudSyncService.consumePendingProvisioningEnrollment();

    expect(logged(log)).toContain('[CloudSync] Queued enrollment discarded: already enrolled');
    expect(KioskModule.clearPendingCloudEnrollment).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays quiet on an enrolled tablet with nothing queued', async () => {
    mockGetCloudCredentials.mockResolvedValue(CREDS);
    KioskModule.getPendingCloudEnrollment.mockResolvedValue(null);

    await CloudSyncService.consumePendingProvisioningEnrollment();

    expect(logged(log)).not.toContain('[CloudSync] Queued enrollment discarded: already enrolled');
    expect(KioskModule.clearPendingCloudEnrollment).not.toHaveBeenCalled();
  });

  it('enrolls with the model and maker the website names the device after', async () => {
    jest.spyOn(Platform, 'constants', 'get').mockReturnValue({ Model: 'SM-X210', Manufacturer: 'samsung', Release: '16' } as any);
    const fetchMock = installFetch(200, { device_id: 'dev-1', api_key: 'fkd_x', organization_name: 'Org' });

    await CloudSyncService.consumePendingProvisioningEnrollment();

    const sent = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(sent.device_info).toMatchObject({ model: 'SM-X210', manufacturer: 'samsung', android_version: '16' });
    expect(enrollmentDeviceInfo().model).toBe('SM-X210');
  });
});
