/**
 * Updated or restarted with the screen off, what comes up is the headless heartbeat: the kiosk screen does
 * not run until someone lights it, so start() does not either. The install that replaced the app then stayed
 * "sent" on the website, however well it had gone.
 */
export {};

const { NativeModules } = require('react-native');
NativeModules.HttpServerModule = { executeNativeCommand: jest.fn(), captureScreenshotBase64: jest.fn() };

jest.mock('../src/utils/secureStorage', () => ({
  ...jest.requireActual('../src/utils/secureStorage'),
  getCloudCredentials: jest.fn(() =>
    Promise.resolve({ deviceId: 'dev-1', apiKey: 'fk_test', cloudUrl: 'https://cloud.test', organizationName: 'Test Org' }),
  ),
  exportSensitiveConfig: jest.fn(() => Promise.resolve({})),
}));

const { CloudSyncService } = require('../src/utils/CloudSyncService');
const { StorageService } = require('../src/utils/storage');

function serve() {
  const results: any[] = [];
  (globalThis as any).fetch = jest.fn(async (url: any, init: any) => {
    const u = String(url);
    if (u.includes('/result/')) {
      results.push({ url: u, ...JSON.parse(init.body) });
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ status: 'ok', pending_commands: 0, sync_action: 'none', config_version: 0, server_time: new Date().toISOString() }),
    };
  });
  return results;
}

const until = async (condition: () => boolean) => {
  for (let i = 0; i < 200 && !condition(); i += 1) await new Promise<void>((done) => setImmediate(done));
  expect(condition()).toBe(true);
};

describe('the first heartbeat of a process with no kiosk screen', () => {
  it('reports the update that replaced the app, once', async () => {
    await StorageService.saveInflightInstall({ commandId: 'self-update', type: 'install_apk', killsProcess: true });
    const results = serve();

    await CloudSyncService.sendHeartbeat(undefined, { force: true });
    await until(() => results.length === 1);
    expect(results[0].url).toContain('/commands/self-update/result/');
    expect(results[0].status).toBe('success');
    expect(results[0].result).toEqual({ restarted: true });
    expect(await StorageService.getInflightInstall()).toBeNull();

    await StorageService.saveInflightInstall({ commandId: 'later', type: 'install_apk', killsProcess: true });
    await CloudSyncService.sendHeartbeat(undefined, { force: true });
    await new Promise<void>((done) => setImmediate(done));
    expect(results).toHaveLength(1);
    await StorageService.saveInflightInstall(null);
  });
});
