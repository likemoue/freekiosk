/**
 * Closing every app takes hiding them, which only a Device Owner can do, and the website goes by this
 * list to tell a tablet that can from one that cannot.
 */
import { Platform } from 'react-native';
import KioskModule from '../src/utils/KioskModule';
import { getCapabilities } from '../src/utils/capabilities';

jest.mock('../src/utils/KioskModule', () => ({
  __esModule: true,
  default: { isDeviceOwner: jest.fn(), hasUsageStatsPermission: jest.fn(() => Promise.resolve(false)) },
}));

const isDeviceOwner = KioskModule.isDeviceOwner as jest.Mock;

beforeAll(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
});

describe('stopping every app', () => {
  it('is offered by a Device Owner', async () => {
    isDeviceOwner.mockResolvedValue(true);
    expect(await getCapabilities()).toContain('stop_apps');
  });

  it('is not offered by any other tablet', async () => {
    isDeviceOwner.mockResolvedValue(false);
    expect(await getCapabilities()).not.toContain('stop_apps');
  });
});

describe('the screen timeout', () => {
  it('is offered by any tablet of this version, Device Owner or not', async () => {
    isDeviceOwner.mockResolvedValue(false);
    expect(await getCapabilities()).toContain('screen_timeout');
  });
});
