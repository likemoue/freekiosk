/**
 * "Check for updates" asks the server an enrolled tablet belongs to, and GitHub otherwise.
 */
export {};

const { NativeModules } = require('react-native');

const mockGitHub = jest.fn();
NativeModules.UpdateModule = {
  ENABLE_SELF_UPDATE: true,
  checkForUpdatesWithChannel: mockGitHub,
};
const mockInstall = jest.fn(() => Promise.resolve({ status: 'success', package: 'com.freekiosk' }));
NativeModules.ManagedAppInstaller = { installFromUrl: mockInstall };

const mockCredentials = jest.fn();
jest.mock('../src/utils/secureStorage', () => ({
  getCloudCredentials: () => mockCredentials(),
}));

const { findLatestUpdate, installFromServer } = require('../src/utils/AppUpdateCheck');

const CREDENTIALS = { deviceId: 'device-1', apiKey: 'fkd_key', cloudUrl: 'https://mdm.test', organizationName: 'Org' };
const GITHUB_RELEASE = { version: '2.1.0', downloadUrl: 'https://github.test/a.apk', isPrerelease: false };

const answer = (status: number, body?: unknown) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

describe('AppUpdateCheck', () => {
  const realFetch = globalThis.fetch;
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    globalThis.fetch = mockFetch as any;
    mockGitHub.mockResolvedValue(GITHUB_RELEASE);
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });

  it('asks GitHub on a tablet that is not enrolled, with the chosen channel', async () => {
    mockCredentials.mockResolvedValue(null);
    expect(await findLatestUpdate(true)).toBe(GITHUB_RELEASE);
    expect(mockGitHub).toHaveBeenCalledWith(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('asks the server of an enrolled tablet, with its device key', async () => {
    mockCredentials.mockResolvedValue(CREDENTIALS);
    mockFetch.mockReturnValue(answer(200, {
      update: {
        version: '2.1.0-beta.3',
        version_code: 55,
        notes: null,
        published_at: '2026-11-04T04:00:00.000Z',
        download_url: 'https://mdm.test/api/v1/devices/device-1/apk/apk-1/',
      },
    }));

    expect(await findLatestUpdate(false)).toEqual({
      version: '2.1.0-beta.3',
      versionCode: 55,
      notes: '',
      publishedAt: '2026-11-04T04:00:00.000Z',
      downloadUrl: 'https://mdm.test/api/v1/devices/device-1/apk/apk-1/',
      isPrerelease: true,
      fromServer: true,
    });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://mdm.test/api/v1/devices/device-1/app-update/');
    expect(options.headers.Authorization).toBe('Bearer fkd_key');
    expect(mockGitHub).not.toHaveBeenCalled();
  });

  it('marks a version without a suffix as a release', async () => {
    mockCredentials.mockResolvedValue(CREDENTIALS);
    mockFetch.mockReturnValue(answer(200, { update: { version: '2.1.0', version_code: 60, download_url: 'https://x/' } }));
    expect((await findLatestUpdate(false)).isPrerelease).toBe(false);
  });

  it('has nothing to offer when the server has no FreeKiosk, without trying GitHub', async () => {
    mockCredentials.mockResolvedValue(CREDENTIALS);
    mockFetch.mockReturnValue(answer(200, { update: null }));
    expect(await findLatestUpdate(false)).toBeNull();
    expect(mockGitHub).not.toHaveBeenCalled();
  });

  it('falls back to GitHub on a server without the route', async () => {
    mockCredentials.mockResolvedValue(CREDENTIALS);
    mockFetch.mockReturnValue(answer(404));
    expect(await findLatestUpdate(false)).toBe(GITHUB_RELEASE);
  });

  it('reports a server failure instead of quietly asking GitHub', async () => {
    mockCredentials.mockResolvedValue(CREDENTIALS);
    mockFetch.mockReturnValue(answer(500));
    await expect(findLatestUpdate(false)).rejects.toThrow('HTTP 500');
    mockFetch.mockReturnValue(Promise.reject(new Error('Network request failed')));
    await expect(findLatestUpdate(false)).rejects.toThrow('Network request failed');
    expect(mockGitHub).not.toHaveBeenCalled();
  });

  it('passes on the reason GitHub gives, for the screen to explain', async () => {
    mockCredentials.mockResolvedValue(null);
    mockGitHub.mockRejectedValue(Object.assign(new Error('No releases published'), { code: 'NO_RELEASES' }));
    await expect(findLatestUpdate(false)).rejects.toMatchObject({ code: 'NO_RELEASES' });
  });

  it('installs from the server with the device key, for its own package only', async () => {
    mockCredentials.mockResolvedValue(CREDENTIALS);
    await installFromServer({ version: '2.1.0-beta.3', downloadUrl: 'https://mdm.test/apk/' });
    expect(mockInstall).toHaveBeenCalledWith('https://mdm.test/apk/', 'fkd_key', 'com.freekiosk');
  });

  it('refuses to install when the tablet left the server in the meantime', async () => {
    mockCredentials.mockResolvedValue(null);
    await expect(installFromServer({ version: '2.1.0', downloadUrl: 'https://mdm.test/apk/' })).rejects.toThrow('Not enrolled');
    expect(mockInstall).not.toHaveBeenCalled();
  });
});
