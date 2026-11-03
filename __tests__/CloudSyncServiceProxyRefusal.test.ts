/**
 * A refused heartbeat counts toward wiping the enrollment only when the server refused it. The
 * block page of a proxy in front of it (Cloudflare, Nginx Proxy Manager) says nothing about this
 * device: counting it would let one rule set too tight unenroll a whole fleet.
 */
export {};

const mockGetStatus = jest.fn(() => Promise.reject(new Error('no telemetry in this test')));
jest.mock('../src/services/DeviceControlService', () => ({
  __esModule: true,
  default: { getStatus: () => mockGetStatus() },
}));
jest.mock('../src/utils/capabilities', () => ({ getCapabilities: () => Promise.resolve([]) }));

const AsyncStorage = require('@react-native-async-storage/async-storage');
const { CloudSyncService } = require('../src/utils/CloudSyncService');

const store = AsyncStorage.default ?? AsyncStorage;
const CREDS = { deviceId: 'dev-1', apiKey: 'fkd_test', cloudUrl: 'https://kiosk.test', organizationName: 'Test' };
const FAILURE_KEY = '@cloud_auth_failure';

function answerWith(status: number, headers: Record<string, string>) {
  (globalThis as any).fetch = jest.fn(() =>
    Promise.resolve({ status, ok: false, headers: { get: (name: string) => headers[name] ?? null } }),
  );
}

describe('a refused heartbeat', () => {
  beforeEach(async () => {
    await store.clear();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['Cloudflare block page', 403, { 'content-type': 'text/html; charset=UTF-8' }],
    ['Cloudflare challenge', 403, { 'content-type': 'application/json', 'cf-mitigated': 'challenge' }],
    ['Nginx Proxy Manager access list', 401, { 'content-type': 'text/html' }],
  ])('by a proxy (%s) does not count toward a wipe', async (_name, status, headers) => {
    answerWith(status, headers);
    await CloudSyncService.sendHeartbeat(CREDS, { force: true });
    expect(await store.getItem(FAILURE_KEY)).toBeNull();
  });

  it('by the server itself, in JSON, does count', async () => {
    answerWith(401, { 'content-type': 'application/json; charset=utf-8' });
    await CloudSyncService.sendHeartbeat(CREDS, { force: true });
    expect(JSON.parse(await store.getItem(FAILURE_KEY)).attempts).toBe(1);
  });
});
