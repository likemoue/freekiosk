/**
 * Three things the website asks of a tablet, and what they must leave behind:
 *
 *   - Opening an app works with no kiosk screen: FreeKiosk started in the background answered
 *     "Handler unavailable" on an SM-X210, since the kiosk screen held the only way to open one.
 *   - Settings left open does not come back to the front behind a command: on another SM-X210 the
 *     website opened iCLASS over Settings, then Bật màn hình showed Settings with no PIN asked.
 *   - Removing apps reports what went, what was not there, and what Android refused.
 */
export {};

// The native stubs have to be in place before the modules load (see CloudCommandService.test.ts)
const { NativeModules } = require('react-native');
const launcher = { launchExternalApp: jest.fn(async () => true), isAppInstalled: jest.fn(async () => true) };
const overlay = { startOverlayService: jest.fn(async () => true) };
const installer = { uninstallPackages: jest.fn() };
NativeModules.AppLauncherModule = launcher;
NativeModules.OverlayServiceModule = overlay;
NativeModules.ManagedAppInstaller = installer;
NativeModules.HttpServerModule = { executeNativeCommand: jest.fn(async () => JSON.stringify({ nativelyHandled: true })), captureScreenshotBase64: jest.fn() };

jest.mock('../src/utils/secureStorage', () => ({
  ...jest.requireActual('../src/utils/secureStorage'),
  getCloudCredentials: jest.fn(() =>
    Promise.resolve({ deviceId: 'dev-1', apiKey: 'fk_test', cloudUrl: 'https://cloud.test', organizationName: 'Test Org' }),
  ),
}));

const { CloudCommandService } = require('../src/utils/CloudCommandService');
const { SettingsSession } = require('../src/utils/SettingsSession');
const { grantSettingsAccess, hasSettingsAccess } = require('../src/utils/authState');
const { StorageService } = require('../src/utils/storage');

/** Hands out one command, and returns what the tablet reported about it */
function deliver(type: string, params: Record<string, unknown> = {}) {
  const reported: any[] = [];
  (globalThis as any).fetch = jest.fn(async (url: any, init: any) => {
    const u = String(url);
    if (u.includes('/updates/')) return { ok: true, status: 200, json: async () => [] };
    if (u.includes('/result/')) {
      reported.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ commands: [{ id: `cmd-${Math.random()}`, type, params, created_at: '', expires_at: new Date(Date.now() + 60_000).toISOString() }] }),
    };
  });
  return reported;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await StorageService.savePendingReports([]);
  await StorageService.saveInflightCommand(null);
});

describe('opening an app from the website', () => {
  it('opens it with no kiosk screen, the overlay first, as a tap on the home screen does', async () => {
    const reported = deliver('launch_app', { package_name: 'vn.iclass', label: 'iCLASS' });
    await CloudCommandService.poll();
    expect(reported[0].status).toBe('success');
    expect(overlay.startOverlayService).toHaveBeenCalled();
    expect((overlay.startOverlayService.mock.calls[0] as any[])[4]).toBe('vn.iclass');
    expect(launcher.launchExternalApp).toHaveBeenCalledWith('vn.iclass');
  });

  it('says so of an app the tablet does not have', async () => {
    launcher.isAppInstalled.mockResolvedValueOnce(false);
    const reported = deliver('launch_app', { package_name: 'vn.khong-co' });
    await CloudCommandService.poll();
    expect(reported[0].status).toBe('error');
    expect(reported[0].error_message).toMatch(/not installed/);
    expect(launcher.launchExternalApp).not.toHaveBeenCalled();
  });
});

describe('Settings left open', () => {
  it('ends behind a command that changes what is on screen, and the PIN is asked again', async () => {
    const ended: string[] = [];
    const stop = SettingsSession.onEnd((reason: string) => ended.push(reason));
    try {
      grantSettingsAccess();
      deliver('launch_app', { package_name: 'vn.iclass' });
      await CloudCommandService.poll();
      expect(ended).toEqual(['launch_app']);
      expect(hasSettingsAccess()).toBe(false);

      grantSettingsAccess();
      deliver('screen_on');
      await CloudCommandService.poll();
      expect(ended).toEqual(['launch_app', 'screen_on']);
    } finally {
      stop();
    }
  });

  it('stays through a command that changes nothing on screen', async () => {
    const ended: string[] = [];
    const stop = SettingsSession.onEnd((reason: string) => ended.push(reason));
    try {
      grantSettingsAccess();
      deliver('toast', { message: 'Bảo trì lúc 17:00' });
      await CloudCommandService.poll();
      expect(ended).toEqual([]);
      expect(hasSettingsAccess()).toBe(true);
    } finally {
      stop();
    }
  });
});

describe('removing apps', () => {
  it('reports what went and what the tablet did not have, and never asks to remove FreeKiosk', async () => {
    installer.uninstallPackages.mockResolvedValueOnce({ removed: ['vn.iclass'], missing: ['vn.khong-co'], failed: [] });
    const reported = deliver('uninstall_app', { packages: ['vn.iclass', 'vn.khong-co', 'com.freekiosk'] });
    await CloudCommandService.poll();
    expect(installer.uninstallPackages).toHaveBeenCalledWith(['vn.iclass', 'vn.khong-co']);
    expect(reported[0].status).toBe('success');
    expect(reported[0].result).toEqual({ removed: ['vn.iclass'], missing: ['vn.khong-co'], failed: [] });
  });

  it('is an error when Android refuses one, with what did go', async () => {
    installer.uninstallPackages.mockResolvedValueOnce({ removed: ['vn.a'], missing: [], failed: ['com.sec.app: status 1: DELETE_FAILED_INTERNAL_ERROR'] });
    const reported = deliver('uninstall_app', { packages: ['vn.a', 'com.sec.app'] });
    await CloudCommandService.poll();
    expect(reported[0].status).toBe('error');
    expect(reported[0].error_message).toMatch(/Could not uninstall com\.sec\.app/);
    expect(reported[0].result.removed).toEqual(['vn.a']);
  });
});
