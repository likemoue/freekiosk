/**
 * The map of the management website. The tablet says where it is only once the website has asked, since
 * asking makes a Device Owner grant itself the permission and turn location on; the heartbeat never waits
 * for a fix; and the command that asks for one now reports what the tablet found, also when nothing.
 */
export {};

// The native stubs have to be in place before the modules load (see CloudCommandService.test.ts)
const { NativeModules } = require('react-native');
const report = { state: 'ok', latitude: 21.028511, longitude: 105.804817, accuracy_m: 32, age_ms: 4000, provider: 'fused' };
const location = { latest: jest.fn(async () => report), locateNow: jest.fn(async () => report) };
NativeModules.DeviceLocation = location;
NativeModules.HttpServerModule = { executeNativeCommand: jest.fn(), captureScreenshotBase64: jest.fn() };

jest.mock('../src/utils/secureStorage', () => ({
  ...jest.requireActual('../src/utils/secureStorage'),
  getCloudCredentials: jest.fn(() =>
    Promise.resolve({ deviceId: 'dev-1', apiKey: 'fk_test', cloudUrl: 'https://cloud.test', organizationName: 'Test Org' }),
  ),
  exportSensitiveConfig: jest.fn(() => Promise.resolve({})),
}));

const storageModule = require('@react-native-async-storage/async-storage');
const AsyncStorage = storageModule.default ?? storageModule;
const { CloudSyncService } = require('../src/utils/CloudSyncService');
const { CloudCommandService } = require('../src/utils/CloudCommandService');
const { LOCATION_MAX_AGE_MS } = require('../src/utils/DeviceLocation');

/** Answers heartbeats, saying whether the website wants locations; keeps what was sent */
function website(wanted: () => boolean | undefined) {
  const beats: any[] = [];
  (globalThis as any).fetch = jest.fn(async (url: any, init: any) => {
    if (String(url).includes('/heartbeat/')) beats.push(JSON.parse(init.body));
    const answer = { status: 'ok', pending_commands: 0, sync_action: 'none', config_version: 0, server_time: new Date().toISOString() };
    const flag = wanted();
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => (flag === undefined ? answer : { ...answer, location_wanted: flag }) };
  });
  return beats;
}

const beat = () => CloudSyncService.sendHeartbeat(undefined, { force: true });

describe('the place of the tablet in its heartbeat', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.removeItem('@cloud_location_wanted');
    (CloudSyncService as any).locationWanted = null;
  });

  it('is not looked for until the website asks, then comes with every heartbeat', async () => {
    const beats = website(() => true);
    await beat();
    expect(beats[0].location).toBeUndefined();
    expect(location.latest).not.toHaveBeenCalled();

    await beat();
    expect(beats[1].location).toEqual(report);
    expect(location.latest).toHaveBeenCalledWith(LOCATION_MAX_AGE_MS);
  });

  it('is remembered across a restart, for the first heartbeat of the next process', async () => {
    website(() => true);
    await beat();
    expect(await AsyncStorage.getItem('@cloud_location_wanted')).toBe('true');

    (CloudSyncService as any).locationWanted = null;
    const beats = website(() => true);
    await beat();
    expect(beats[0].location).toEqual(report);
  });

  it('stops as soon as the website stops asking, and from a website that never asks', async () => {
    let wanted: boolean | undefined = true;
    const beats = website(() => wanted);
    await beat();
    wanted = false;
    await beat();
    expect(beats[1].location).toEqual(report);
    wanted = undefined;
    await beat();
    await beat();
    expect(beats[2].location).toBeUndefined();
    expect(beats[3].location).toBeUndefined();
  });
});

describe('the command that asks for a place now', () => {
  function deliver() {
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
        json: async () => ({ commands: [{ id: `locate-${Math.random()}`, type: 'locate', params: {}, created_at: '', expires_at: new Date(Date.now() + 60_000).toISOString() }] }),
      };
    });
    return reported;
  }

  it('reports the place found', async () => {
    const reported = deliver();
    await CloudCommandService.poll();
    expect(reported[0].status).toBe('success');
    expect(reported[0].result).toEqual({ location: report });
  });

  it('reports why there is none, for the website to put in words', async () => {
    location.locateNow.mockResolvedValueOnce({ state: 'disabled' } as any);
    const reported = deliver();
    await CloudCommandService.poll();
    expect(reported[0].status).toBe('success');
    expect(reported[0].result).toEqual({ location: { state: 'disabled' } });
  });
});
