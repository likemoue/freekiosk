/**
 * Back on the Settings screen, which a tablet has no other quick way out of. It must ask first and
 * must not leave the PIN open behind it (#93).
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert, BackHandler } from 'react-native';
import SettingsScreenNew from '../src/screens/settings/SettingsScreenNew';
import BlockingOverlaysScreen from '../src/screens/settings/BlockingOverlaysScreen';
import { grantSettingsAccess, hasSettingsAccess } from '../src/utils/authState';

// jest.setup.js gives the camera its component only; Settings also listens for its devices
Object.assign(require('react-native-vision-camera').Camera, {
  addCameraDevicesChangedListener: () => ({ remove: () => {} }),
  getAvailableCameraDevices: () => [],
});

// Android calls the newest handler first and stops at the first one that returns true
const handlers: Array<() => boolean> = [];
const pressBack = () => [...handlers].reverse().some((handler) => handler());

function mockNavigation() {
  return { reset: jest.fn(), goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) } as any;
}

// The screen reads its settings for a while after mounting: that has to end with the test
const settle = () => ReactTestRenderer.act(() => new Promise<void>((done) => setTimeout(() => done(), 800)));

const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function mount(element: React.ReactElement) {
  await ReactTestRenderer.act(async () => {
    mounted.push(ReactTestRenderer.create(element));
  });
  await settle();
}

describe('Back in Settings', () => {
  let alert: jest.SpyInstance;

  beforeEach(() => {
    handlers.length = 0;
    jest.spyOn(BackHandler, 'addEventListener').mockImplementation(((_event: string, handler: () => boolean) => {
      handlers.push(handler);
      return { remove: () => handlers.splice(handlers.indexOf(handler), 1) };
    }) as any);
    alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    grantSettingsAccess();
  });

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      mounted.splice(0).forEach((renderer) => renderer.unmount());
    });
    await settle();
    jest.restoreAllMocks();
  });

  it('asks before leaving, and staying changes nothing', async () => {
    const navigation = mockNavigation();
    await mount(<SettingsScreenNew navigation={navigation} />);

    expect(pressBack()).toBe(true);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(navigation.reset).not.toHaveBeenCalled();

    const buttons = alert.mock.calls[0][2];
    expect(buttons.find((button: any) => button.style === 'cancel').onPress).toBeUndefined();
    expect(hasSettingsAccess()).toBe(true);
  });

  it('leaves for the kiosk with access revoked, so the PIN is asked again', async () => {
    const navigation = mockNavigation();
    await mount(<SettingsScreenNew navigation={navigation} />);

    pressBack();
    alert.mock.calls[0][2].find((button: any) => button.style === 'destructive').onPress();

    expect(navigation.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Kiosk' }] });
    expect(hasSettingsAccess()).toBe(false);
  });

  it('closes only the Blocking Overlays screen when that one is on top', async () => {
    const settingsNavigation = mockNavigation();
    const overlaysNavigation = mockNavigation();
    await mount(<SettingsScreenNew navigation={settingsNavigation} />);
    await mount(<BlockingOverlaysScreen navigation={overlaysNavigation} />);

    expect(pressBack()).toBe(true);
    expect(overlaysNavigation.goBack).toHaveBeenCalledTimes(1);
    expect(alert).not.toHaveBeenCalled();
    expect(settingsNavigation.reset).not.toHaveBeenCalled();
    expect(hasSettingsAccess()).toBe(true);
  });
});
