/**
 * A word from the website (CloudWake.kt) makes the tablet fetch what is waiting right away, and an
 * APK taking minutes to download does not hold up a command sent in the meantime.
 */
export {};

const { NativeModules } = require('react-native');
const kiosk = { startCloudWake: jest.fn(), stopCloudWake: jest.fn(), ensureKeepAliveWatchdog: jest.fn(() => Promise.resolve()), acquireCloudWakeLock: jest.fn(() => Promise.resolve()), releaseCloudWakeLock: jest.fn(() => Promise.resolve()), requestIgnoreBatteryOptimizations: jest.fn(() => Promise.resolve()), stopRunningApps: jest.fn(() => Promise.resolve([])) };
NativeModules.KioskModule = kiosk;
const http = { executeNativeCommand: jest.fn(() => Promise.resolve(JSON.stringify({ ok: true }))), captureScreenshotBase64: jest.fn(), setVolume: jest.fn(() => Promise.resolve(true)) };
NativeModules.HttpServerModule = http;

jest.mock('../src/services/DeviceControlService', () => ({
  __esModule: true,
  default: {
    getStatus: () => Promise.resolve({
      battery: { level: 80, charging: false, plugged: 'none', present: true },
      screen: { on: true, brightness: 50 },
      webview: { currentUrl: '' },
      device: { ip: '', kioskMode: true, isDeviceOwner: true, version: '2.1.0', model: 'SM-X210', manufacturer: 'Samsung', androidVersion: '16', freeStorageMb: 1, freeMemoryMb: 1, uptime: 1 },
      wifi: { ssid: 'x', signalStrength: -50, connected: true, ethernet: false },
      cellular: { connected: false, carrier: '', networkType: '', signalDbm: 0, airplaneMode: false },
      timestamp: 0,
    }),
  },
}));
jest.mock('../src/utils/capabilities', () => ({ getCapabilities: () => Promise.resolve([]) }));

const CREDS = { deviceId: 'dev-1', apiKey: 'fk_test', cloudUrl: 'https://cloud.test', organizationName: 'Org' };
jest.mock('../src/utils/secureStorage', () => ({
  ...jest.requireActual('../src/utils/secureStorage'),
  getCloudCredentials: jest.fn(() => Promise.resolve({ deviceId: 'dev-1', apiKey: 'fk_test', cloudUrl: 'https://cloud.test', organizationName: 'Org' })),
}));

let release: (() => void) | null = null;
jest.mock('../src/utils/ManagedAppInstaller', () => ({
  __esModule: true,
  default: {
    // An install that lasts until the test says so
    installFromUrl: () => new Promise((done) => { release = () => done({ status: 'success' }); }),
  },
}));

const { DeviceEventEmitter } = require('react-native');
const { CloudSyncService, CONFIG_UPDATED_EVENT } = require('../src/utils/CloudSyncService');
const { CloudCommandService } = require('../src/utils/CloudCommandService');
const { StorageService } = require('../src/utils/storage');

const tick = () => new Promise<void>((done) => setImmediate(done));

interface Server {
  commands?: unknown[];
  updates?: unknown[];
  heartbeat?: (index: number) => Record<string, unknown>;
}

const calls: string[] = [];
const reported: Array<{ id: string; body: any }> = [];
let heartbeats: any[] = [];

function server({ commands = [], updates = [], heartbeat }: Server) {
  let served = 0;
  (globalThis as any).fetch = jest.fn(async (url: string, init?: any) => {
    const path = String(url).replace(CREDS.cloudUrl, '');
    calls.push(path);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (path.endsWith('/commands/')) {
      const list = commands;
      commands = [];
      return json({ commands: list });
    }
    if (path.endsWith('/updates/')) {
      const list = updates;
      updates = [];
      return json(list);
    }
    if (path.includes('/result/')) {
      reported.push({ id: path.split('/')[4], body: JSON.parse(init.body) });
      return json({});
    }
    if (path.endsWith('/heartbeat/')) {
      heartbeats.push(JSON.parse(init.body));
      return json({ status: 'ok', pending_commands: 0, server_time: new Date().toISOString(), sync_action: 'none', config: null, sensitive_config: null, config_version: 0, force_unenroll: false, ...heartbeat?.(served++) });
    }
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(async () => {
  jest.clearAllMocks();
  calls.length = 0;
  reported.length = 0;
  heartbeats = [];
  await StorageService.savePendingReports([]);
  await StorageService.saveInflightCommand(null);
  await StorageService.saveInflightInstall(null);
});

const command = (id: string, type = 'stop_apps', params = {}) => ({ id, type, params, created_at: '', expires_at: '' });

describe('a word from the website', () => {
  it('fetches commands right away, with no heartbeat to wait for', async () => {
    server({ commands: [command('c1')] });
    await CloudSyncService.handleWake({ commands: true, config: false });
    expect(kiosk.stopRunningApps).toHaveBeenCalledTimes(1);
    expect(reported[0].id).toBe('c1');
    expect(reported[0].body.status).toBe('success');
    expect(heartbeats).toHaveLength(0);
  });

  it('fetches settings with a heartbeat, whatever the time since the last one', async () => {
    server({});
    await CloudSyncService.sendHeartbeat(CREDS, { force: true });
    expect(heartbeats).toHaveLength(1);
    await CloudSyncService.handleWake({ commands: false, config: true });
    expect(heartbeats).toHaveLength(2);
    expect(calls.some((call) => call.endsWith('/commands/'))).toBe(false);
  });

  it('applies a setting, then says so at once rather than at the next tick', async () => {
    const seen = jest.fn();
    const subscription = DeviceEventEmitter.addListener(CONFIG_UPDATED_EVENT, seen);
    server({
      heartbeat: (index) => (index === 0 ? { sync_action: 'apply', config: { display: { defaultBrightness: 0.4 } }, config_version: 7 } : { config_version: 7 }),
    });
    await CloudSyncService.handleWake({ config: true });
    subscription.remove();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(heartbeats).toHaveLength(2);
    expect(heartbeats[1].config_version).toBe(7);
  });

  it('does not beat twice when nothing changed', async () => {
    server({});
    await CloudSyncService.handleWake({ config: true });
    expect(heartbeats).toHaveLength(1);
  });

  it('beats one at a time when two words come together, and misses neither', async () => {
    server({});
    await Promise.all([CloudSyncService.handleWake({ config: true }), CloudSyncService.handleWake({ config: true })]);
    expect(heartbeats).toHaveLength(2);
  });

  it('asks the native side to keep listening, with every beat', async () => {
    server({});
    await CloudSyncService.sendHeartbeat(CREDS, { force: true });
    expect(kiosk.startCloudWake).toHaveBeenCalledWith(CREDS.cloudUrl, CREDS.deviceId, CREDS.apiKey);
  });

  it('stops listening with the rest of the loop', () => {
    CloudSyncService.stop();
    expect(kiosk.stopCloudWake).toHaveBeenCalled();
  });
});

describe('a command while an APK installs', () => {
  const installing = async (id: string) => {
    server({ updates: [{ command_id: id, package_name: 'vn.app', version_name: '1.0', download_url: 'https://cloud.test/apk' }] });
    const first = CloudCommandService.poll(CREDS);
    for (let i = 0; i < 20 && !release; i++) await tick();
    expect(release).not.toBeNull();
    // In a box: returning the promise itself from here would wait for the install
    return { done: first };
  };
  const finish = async (install: { done: Promise<void> }) => {
    release!();
    release = null;
    await install.done;
  };

  it('does not wait for it', async () => {
    const first = await installing('u1');
    server({ commands: [command('c2')] });
    await CloudCommandService.poll(CREDS);
    expect(kiosk.stopRunningApps).toHaveBeenCalledTimes(1);
    expect(reported.map((r) => r.id)).toEqual(['c2']);
    await finish(first);
    expect(reported.map((r) => r.id)).toContain('u1');
  });

  it('leaves the mark of the install alone, for when FreeKiosk updates itself', async () => {
    const first = await installing('u2');
    expect(await StorageService.getInflightInstall()).toMatchObject({ commandId: 'u2' });
    server({ commands: [command('c3')] });
    await CloudCommandService.poll(CREDS);
    expect(await StorageService.getInflightInstall()).toMatchObject({ commandId: 'u2' });
    // And a word during the install does not read it as left over from a previous run
    expect(reported.map((r) => r.id)).not.toContain('u2');
    await finish(first);
    expect(await StorageService.getInflightInstall()).toBeNull();
  });

  it('reports an install the restart cut short, as a success when it was FreeKiosk itself', async () => {
    await StorageService.saveInflightInstall({ commandId: 'u9', type: 'install_apk', killsProcess: true });
    server({});
    await CloudCommandService.poll(CREDS);
    expect(reported.find((r) => r.id === 'u9')?.body.status).toBe('success');
    expect(await StorageService.getInflightInstall()).toBeNull();
  });
});

describe('a word while commands run', () => {
  it('looks again when done, rather than lose it', async () => {
    let answer: (value: any) => void = () => {};
    kiosk.stopRunningApps.mockImplementationOnce(() => new Promise((done) => { answer = done; }));
    server({ commands: [command('c4')] });
    const first = CloudCommandService.poll(CREDS);
    for (let i = 0; i < 20 && kiosk.stopRunningApps.mock.calls.length === 0; i++) await tick();

    // Sent while the first one runs: nothing is fetching any more, and the word must not be lost
    server({ commands: [command('c5')] });
    await CloudCommandService.poll(CREDS);
    expect(reported).toHaveLength(0);

    answer([]);
    await first;
    expect(reported.map((r) => r.id)).toEqual(['c4', 'c5']);
  });
});

describe('the volume', () => {
  const run = async (params: Record<string, unknown>) => {
    server({ commands: [command(`v-${Math.random()}`, 'set_volume', params)] });
    await CloudCommandService.poll(CREDS);
    return reported[reported.length - 1].body;
  };

  it('goes straight to Android and says what it set', async () => {
    const body = await run({ percent: '35' });
    expect(http.setVolume).toHaveBeenCalledWith(35);
    expect(body).toMatchObject({ status: 'success', result: { percent: 35 } });
  });

  it('takes 0, which is not nothing', async () => {
    await run({ percent: 0 });
    expect(http.setVolume).toHaveBeenCalledWith(0);
  });

  it('touches nothing when the value is not one', async () => {
    for (const percent of ['', 'to', 101, -1, undefined]) {
      expect((await run({ percent })).status).toBe('error');
    }
    expect(http.setVolume).not.toHaveBeenCalled();
  });

  it('reports what the tablet refused', async () => {
    http.setVolume.mockRejectedValueOnce(new Error('nope'));
    expect(await run({ percent: 10 })).toMatchObject({ status: 'error', error_message: 'nope' });
  });
});
