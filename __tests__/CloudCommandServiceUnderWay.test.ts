/**
 * The kiosk screen coming back, from Settings say, starts the cloud loop again in the same process, and
 * that looks for commands a previous run left unfinished. An install under way then was called
 * interrupted and went on to finish: on a real tablet, "Device restarted..." for an app that did install.
 */
export {};

const { NativeModules } = require('react-native');
const kiosk = { stopRunningApps: jest.fn() };
NativeModules.KioskModule = kiosk;
NativeModules.HttpServerModule = { executeNativeCommand: jest.fn(), captureScreenshotBase64: jest.fn() };

jest.mock('../src/utils/ManagedAppInstaller', () => ({ __esModule: true, default: { installFromUrl: jest.fn() } }));
jest.mock('../src/utils/secureStorage', () => ({
  ...jest.requireActual('../src/utils/secureStorage'),
  getCloudCredentials: jest.fn(() =>
    Promise.resolve({ deviceId: 'dev-1', apiKey: 'fk_test', cloudUrl: 'https://cloud.test', organizationName: 'Test Org' }),
  ),
}));

const { CloudCommandService } = require('../src/utils/CloudCommandService');
const { StorageService } = require('../src/utils/storage');
const ManagedAppInstaller = require('../src/utils/ManagedAppInstaller').default;

function serve(work: { updates?: any[]; commands?: any[] }) {
  const reports: any[] = [];
  let given = false;
  (globalThis as any).fetch = jest.fn(async (url: any, init: any) => {
    const u = String(url);
    if (u.includes('/result/')) {
      reports.push({ url: u, ...JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({}) };
    }
    const first = !given;
    if (u.includes('/updates/')) return { ok: true, status: 200, json: async () => (first ? work.updates ?? [] : []) };
    given = true;
    return { ok: true, status: 200, json: async () => ({ commands: first ? work.commands ?? [] : [] }) };
  });
  return reports;
}

const until = async (condition: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200 && !(await condition()); i += 1) await new Promise<void>((done) => setImmediate(done));
  expect(await condition()).toBe(true);
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

beforeEach(async () => {
  jest.clearAllMocks();
  await StorageService.savePendingReports([]);
  await StorageService.saveInflightCommand(null);
  await StorageService.saveInflightInstall(null);
});

describe('the kiosk screen coming back while something runs', () => {
  it('leaves an install under way alone, which then says how it ended', async () => {
    const install = deferred<{ status: string }>();
    ManagedAppInstaller.installFromUrl.mockReturnValue(install.promise);
    const reports = serve({ updates: [{ command_id: 'install-1', package_name: 'vn.ipro', version_name: '1.2.3', download_url: 'https://x/a' }] });

    const polling = CloudCommandService.poll();
    await until(() => ManagedAppInstaller.installFromUrl.mock.calls.length === 1);

    await CloudCommandService.settleOutstanding();
    expect(reports).toEqual([]);
    expect((await StorageService.getInflightInstall()).commandId).toBe('install-1');

    install.resolve({ status: 'success' });
    await polling;
    expect(reports).toHaveLength(1);
    expect(reports[0].url).toContain('/commands/install-1/result/');
    expect(reports[0].status).toBe('success');
    expect(await StorageService.getInflightInstall()).toBeNull();
  });

  it('leaves a command under way alone too', async () => {
    const stopping = deferred<string[]>();
    kiosk.stopRunningApps.mockReturnValue(stopping.promise);
    const reports = serve({ commands: [{ id: 'stop-1', type: 'stop_apps', params: {}, created_at: '', expires_at: '' }] });

    const polling = CloudCommandService.poll();
    await until(() => kiosk.stopRunningApps.mock.calls.length === 1);

    await CloudCommandService.settleOutstanding();
    expect(reports).toEqual([]);

    stopping.resolve(['vn.iclass']);
    await polling;
    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe('success');
  });

  it('still calls an install a previous run left unfinished interrupted', async () => {
    await StorageService.saveInflightInstall({ commandId: 'install-old', type: 'install_apk', killsProcess: false });
    const reports = serve({});
    await CloudCommandService.settleOutstanding();

    expect(reports).toHaveLength(1);
    expect(reports[0].status).toBe('error');
    expect(reports[0].error_message).toMatch(/restarted/i);
    expect(await StorageService.getInflightInstall()).toBeNull();
  });

  it('still takes a self-update the process died in for a success', async () => {
    await StorageService.saveInflightInstall({ commandId: 'install-self', type: 'install_apk', killsProcess: true });
    const reports = serve({});
    await CloudCommandService.settleOutstanding();

    expect(reports[0].status).toBe('success');
    expect(reports[0].result).toEqual({ restarted: true });
  });
});
