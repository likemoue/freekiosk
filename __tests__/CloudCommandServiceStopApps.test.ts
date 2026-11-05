/**
 * The command that closes what students left open at the end of a lesson:
 *
 *   - it names the apps the kiosk opens, so they are closed even with no usage access
 *   - it says which apps it stopped, for the command history
 *   - it stays out of the action layer the local REST API and MQTT also drive
 */
export {};

// See CloudCommandService.test.ts: the native stubs have to be replaced before the module loads
const { NativeModules } = require('react-native');
const kiosk = { stopRunningApps: jest.fn(), setScreenOffTimeout: jest.fn() };
const nativeHttp = { executeNativeCommand: jest.fn(), captureScreenshotBase64: jest.fn() };
NativeModules.KioskModule = kiosk;
NativeModules.HttpServerModule = nativeHttp;

const { CloudCommandService } = require('../src/utils/CloudCommandService');
const { StorageService } = require('../src/utils/storage');

jest.mock('../src/utils/secureStorage', () => ({
  ...jest.requireActual('../src/utils/secureStorage'),
  getCloudCredentials: jest.fn(() =>
    Promise.resolve({ deviceId: 'dev-1', apiKey: 'fk_test', cloudUrl: 'https://cloud.test', organizationName: 'Test Org' }),
  ),
}));

const app = (packageName: string, showOnHomeScreen = true) => ({
  packageName,
  displayName: packageName,
  showOnHomeScreen,
  launchOnBoot: false,
  keepAlive: false,
  allowAccessibility: false,
});

/** Hands out one command, and returns what the tablet reported about it */
function deliver(id: string, type = 'stop_apps', params: Record<string, unknown> = {}) {
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
      json: async () => ({ commands: [{ id, type, params, created_at: '', expires_at: new Date(Date.now() + 60_000).toISOString() }] }),
    };
  });
  return reported;
}

beforeEach(async () => {
  jest.clearAllMocks();
  await StorageService.savePendingReports([]);
  await StorageService.saveInflightCommand(null);
  await StorageService.saveManagedApps([]);
  await StorageService.saveExternalAppPackage('');
});

describe('stopping every app', () => {
  it('names every app the kiosk opens, on the home screen or not, and reports what stopped', async () => {
    await StorageService.saveManagedApps([app('vn.iclass'), app('vn.background', false)]);
    await StorageService.saveExternalAppPackage('vn.single');
    kiosk.stopRunningApps.mockResolvedValue(['vn.iclass', 'vn.chrome']);

    const reported = deliver('cmd-stop-1');
    await CloudCommandService.poll();

    expect(kiosk.stopRunningApps).toHaveBeenCalledWith(['vn.iclass', 'vn.background', 'vn.single'], false);
    expect(reported).toEqual([{ status: 'success', result: { stopped: ['vn.iclass', 'vn.chrome'] }, error_message: '' }]);
  });

  it('still asks when the kiosk opens no app: something else may have been on screen', async () => {
    kiosk.stopRunningApps.mockResolvedValue([]);
    const reported = deliver('cmd-stop-2');
    await CloudCommandService.poll();

    expect(kiosk.stopRunningApps).toHaveBeenCalledWith([], false);
    expect(reported[0].status).toBe('success');
  });

  it('keeps single-app mode from opening its app again, and leaves several apps on their grid', async () => {
    kiosk.stopRunningApps.mockResolvedValue([]);
    await StorageService.saveDisplayMode('external_app');
    await StorageService.saveExternalAppMode('single');
    deliver('cmd-stop-5');
    await CloudCommandService.poll();
    expect(kiosk.stopRunningApps).toHaveBeenLastCalledWith([], true);

    await StorageService.saveExternalAppMode('multi');
    deliver('cmd-stop-6');
    await CloudCommandService.poll();
    expect(kiosk.stopRunningApps).toHaveBeenLastCalledWith([], false);

    await StorageService.saveDisplayMode('webview');
    await StorageService.saveExternalAppMode('single');
  });

  it('reports the refusal of a tablet that is not Device Owner', async () => {
    kiosk.stopRunningApps.mockRejectedValue(new Error('Stopping apps requires Device Owner mode'));
    const reported = deliver('cmd-stop-3');
    await CloudCommandService.poll();

    expect(reported).toEqual([{ status: 'error', result: null, error_message: 'Stopping apps requires Device Owner mode' }]);
  });

  it('does not go through the action layer the LAN can reach', async () => {
    kiosk.stopRunningApps.mockResolvedValue([]);
    deliver('cmd-stop-4');
    await CloudCommandService.poll();

    expect(nativeHttp.executeNativeCommand).not.toHaveBeenCalled();
  });
});

describe('what the server hands over', () => {
  it("runs a command the server gave it, even with this tablet's clock hours ahead", async () => {
    kiosk.stopRunningApps.mockResolvedValue([]);
    const reported = deliver('cmd-clock-1');
    const realNow = Date.now;
    // deliver() dates the command by Date.now(), so the clock moves once it has been handed over
    const fetchCommands = (globalThis as any).fetch;
    (globalThis as any).fetch = jest.fn(async (...args: any[]) => {
      const answer = await fetchCommands(...args);
      Date.now = () => realNow() + 5 * 3_600_000;
      return answer;
    });
    try {
      await CloudCommandService.poll();
    } finally {
      Date.now = realNow;
    }
    expect(kiosk.stopRunningApps).toHaveBeenCalled();
    expect(reported[0].status).toBe('success');
  });

  // Each of these is a key of every object: "constructor" ran what was in its params
  it.each(['constructor', 'toString', 'hasOwnProperty'])('does not take %s for a command', async (type) => {
    const reported = deliver(`cmd-odd-${type}`, type, { command: 'executeJs', params: { code: 'x' } });
    await CloudCommandService.poll();

    expect(nativeHttp.executeNativeCommand).not.toHaveBeenCalled();
    expect(reported[0].status).toBe('error');
    expect(reported[0].error_message).toMatch(/Unsupported/);
  });
});

describe('the screen timeout', () => {
  it('reaches Android in seconds, and says what it set', async () => {
    kiosk.setScreenOffTimeout.mockResolvedValue(true);
    const reported = deliver('cmd-time-1', 'set_screen_timeout', { seconds: '600' });
    await CloudCommandService.poll();

    expect(kiosk.setScreenOffTimeout).toHaveBeenCalledWith(600);
    expect(reported).toEqual([{ status: 'success', result: { seconds: 600 }, error_message: '' }]);
  });

  it('takes never, which is -1', async () => {
    kiosk.setScreenOffTimeout.mockResolvedValue(true);
    deliver('cmd-time-2', 'set_screen_timeout', { seconds: -1 });
    await CloudCommandService.poll();

    expect(kiosk.setScreenOffTimeout).toHaveBeenCalledWith(-1);
  });

  it('touches nothing when the value is not one', async () => {
    const reported = deliver('cmd-time-3', 'set_screen_timeout', {});
    await CloudCommandService.poll();

    expect(kiosk.setScreenOffTimeout).not.toHaveBeenCalled();
    expect(reported[0].status).toBe('error');
  });

  it('reports what the tablet refused', async () => {
    kiosk.setScreenOffTimeout.mockRejectedValue(new Error('Changing the screen timeout requires Device Owner mode'));
    const reported = deliver('cmd-time-4', 'set_screen_timeout', { seconds: 60 });
    await CloudCommandService.poll();

    expect(reported[0]).toEqual({ status: 'error', result: null, error_message: 'Changing the screen timeout requires Device Owner mode' });
  });
});
