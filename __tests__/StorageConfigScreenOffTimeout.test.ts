/**
 * The screen timeout travels with the config (display.screenOffTimeout), so a profile taken from a tablet
 * carries it and applying one sets it. Android keeps the value: the config reports what is in effect, and
 * importing sets it through KioskModule, which needs Device Owner on a real tablet.
 */
export {};

const { NativeModules } = require('react-native');
const kiosk = { getScreenOffTimeout: jest.fn(), setScreenOffTimeout: jest.fn() };
NativeModules.KioskModule = kiosk;

const AsyncStorage = require('@react-native-async-storage/async-storage');
const { StorageService, screenOffTimeoutOf } = require('../src/utils/storage');

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  kiosk.setScreenOffTimeout.mockResolvedValue(true);
});

describe('exporting the screen timeout', () => {
  it('reports what Android has', async () => {
    kiosk.getScreenOffTimeout.mockResolvedValue(30);
    const exported: any = await StorageService.exportConfig();
    expect(exported.display.screenOffTimeout).toBe(30);
  });

  it('reports never as -1', async () => {
    kiosk.getScreenOffTimeout.mockResolvedValue(-1);
    expect(((await StorageService.exportConfig()) as any).display.screenOffTimeout).toBe(-1);
  });

  it('leaves it out when Android does not answer, so a profile never carries a value nobody read', async () => {
    kiosk.getScreenOffTimeout.mockRejectedValue(new Error('no settings'));
    expect(((await StorageService.exportConfig()) as any).display).not.toHaveProperty('screenOffTimeout');
  });

  it('reports what Android has over what the website sent last', async () => {
    await StorageService.importConfig({ display: { screenOffTimeout: 30 } });
    kiosk.getScreenOffTimeout.mockResolvedValue(600);
    expect(((await StorageService.exportConfig()) as any).display.screenOffTimeout).toBe(600);
  });
});

describe('importing the screen timeout', () => {
  it('sets it, from a number or the text a form may send', async () => {
    await StorageService.importConfig({ display: { screenOffTimeout: 30 } });
    await StorageService.importConfig({ display: { screenOffTimeout: '600' } });
    await StorageService.importConfig({ display: { screenOffTimeout: -1 } });
    expect(kiosk.setScreenOffTimeout.mock.calls).toEqual([[30], [600], [-1]]);
  });

  it('leaves Android alone without a valid value', async () => {
    await StorageService.importConfig({ display: { keepScreenOn: false } });
    for (const value of [5, 0, 1.5, 100_000, 'abc', '', null]) {
      await StorageService.importConfig({ display: { screenOffTimeout: value } });
    }
    expect(kiosk.setScreenOffTimeout).not.toHaveBeenCalled();
  });

  it('still saves the rest when Android refuses', async () => {
    kiosk.setScreenOffTimeout.mockRejectedValue(new Error('Changing the screen timeout requires Device Owner mode'));
    await StorageService.importConfig({ display: { keepScreenOn: false, screenOffTimeout: 30 } });
    expect(await StorageService.getKeepScreenOn()).toBe(false);
  });
});

it('takes the values the server takes for its command', () => {
  expect([15, 30, 86_400, -1].map(screenOffTimeoutOf)).toEqual([15, 30, 86_400, -1]);
  expect([14, 86_401, -2].map(screenOffTimeoutOf)).toEqual([null, null, null]);
});
