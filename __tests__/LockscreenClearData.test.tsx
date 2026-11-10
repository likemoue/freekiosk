/**
 * The PIN screen's Clear data button: off unless chosen, shown only where Android lets it work, and it
 * clears what was picked among the kiosk screen's apps, after asking, and nothing else.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { NativeModules, Platform, Alert, Text, TouchableOpacity } = require('react-native');

const LABELS: Record<string, string> = {
  'vn.iclass': 'iCLASS',
  'vn.ipro': 'iSMART Pro',
  'vn.background': 'Background',
};
const kiosk = { clearAppData: jest.fn(), isDeviceOwner: jest.fn(), launchEmergencyDial: jest.fn() };
const launcher = {
  isAppInstalled: jest.fn(async (name: string) => name !== 'vn.gone'),
  getPackageLabel: jest.fn(async (name: string) => LABELS[name] ?? name),
  getAppIcon: jest.fn(async () => {
    throw new Error('no icon');
  }),
  addListener: jest.fn(),
  removeListeners: jest.fn(),
};
NativeModules.KioskModule = kiosk;
NativeModules.AppLauncherModule = launcher;

const { StorageService } = require('../src/utils/storage');
const { getKioskApps } = require('../src/utils/KioskApps');
const PinInput = require('../src/components/PinInput').default;

const app = (packageName: string, showOnHomeScreen = true) => ({
  packageName,
  displayName: '',
  showOnHomeScreen,
  launchOnBoot: false,
  keepAlive: false,
  allowAccessibility: false,
});

async function multiApp(packages: string[]) {
  await StorageService.saveDisplayMode('external_app');
  await StorageService.saveExternalAppMode('multi');
  await StorageService.saveManagedApps(packages.map((name) => app(name)));
}

const version = Object.getOwnPropertyDescriptor(Platform, 'Version');
const onAndroid = (sdk: number) => Object.defineProperty(Platform, 'Version', { configurable: true, get: () => sdk });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  onAndroid(35);
  kiosk.isDeviceOwner.mockResolvedValue(true);
});

afterAll(() => {
  if (version) Object.defineProperty(Platform, 'Version', version);
});

describe('the setting', () => {
  it('is off by default', async () => {
    expect(await StorageService.getLockscreenClearDataEnabled()).toBe(false);
  });

  it('goes through the config export and import, which the website pushes', async () => {
    await StorageService.saveLockscreenClearDataEnabled(true);
    const exported: any = await StorageService.exportConfig();
    expect(exported.security.lockscreen.clearData).toBe(true);

    await AsyncStorage.clear();
    await StorageService.importConfig(exported);
    expect(await StorageService.getLockscreenClearDataEnabled()).toBe(true);
  });

  it('is cleared by clearAll', async () => {
    await StorageService.saveLockscreenClearDataEnabled(true);
    await StorageService.clearAll();
    expect(await StorageService.getLockscreenClearDataEnabled()).toBe(false);
  });
});

describe('the apps it offers', () => {
  it('with several apps: those on the grid, installed, never FreeKiosk', async () => {
    await StorageService.saveDisplayMode('external_app');
    await StorageService.saveExternalAppMode('multi');
    await StorageService.saveManagedApps([
      app('vn.iclass'),
      app('vn.background', false),
      app('vn.gone'),
      app('com.freekiosk'),
      app('vn.ipro'),
      app('vn.iclass'),
    ]);

    const apps = await getKioskApps();
    expect(apps).toEqual([
      { packageName: 'vn.iclass', label: 'iCLASS' },
      { packageName: 'vn.ipro', label: 'iSMART Pro' },
    ]);
  });

  it('with one app: that app', async () => {
    await StorageService.saveDisplayMode('external_app');
    await StorageService.saveExternalAppMode('single');
    await StorageService.saveExternalAppPackage('vn.iclass');
    await StorageService.saveManagedApps([app('vn.ipro')]);

    expect((await getKioskApps()).map((a: any) => a.packageName)).toEqual(['vn.iclass']);
  });

  it('none when the kiosk shows a web page', async () => {
    await StorageService.saveDisplayMode('webview');
    await StorageService.saveManagedApps([app('vn.ipro')]);

    expect(await getKioskApps()).toEqual([]);
  });
});

describe('the button on the PIN screen', () => {
  const BUTTON = 'components.pinInput.clearData';
  const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

  const settle = () =>
    ReactTestRenderer.act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

  async function mountPin(clearData = true) {
    await StorageService.saveLockscreenControlsEnabled(true);
    await StorageService.saveLockscreenClearDataEnabled(clearData);
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<PinInput onSuccess={jest.fn()} storedPin="" />);
    });
    await settle();
    mounted.push(renderer!);
    return renderer!;
  }

  const texts = (renderer: ReactTestRenderer.ReactTestRenderer): unknown[] =>
    renderer.root.findAllByType(Text).map((node) => node.props.children);

  // The innermost touchable holding this text: the dialog's backdrop holds them all
  async function press(renderer: ReactTestRenderer.ReactTestRenderer, label: string) {
    const matches = renderer.root
      .findAllByType(TouchableOpacity)
      .filter((node) => node.findAllByType(Text).some((text) => text.props.children === label));
    expect(matches.length).toBeGreaterThan(0);
    await ReactTestRenderer.act(async () => {
      matches[matches.length - 1].props.onPress();
    });
    await settle();
  }

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      mounted.splice(0).forEach((renderer) => renderer.unmount());
    });
  });

  it('is there when chosen, on a Device Owner with Android 9', async () => {
    expect(texts(await mountPin())).toContain(BUTTON);
  });

  it('is not there unless chosen', async () => {
    expect(texts(await mountPin(false))).not.toContain(BUTTON);
  });

  it('is not there without Device Owner, which Android needs to clear another app', async () => {
    kiosk.isDeviceOwner.mockResolvedValue(false);
    expect(texts(await mountPin())).not.toContain(BUTTON);
  });

  it('is not there before Android 9', async () => {
    onAndroid(27);
    expect(texts(await mountPin())).not.toContain(BUTTON);
  });

  it('clears the app picked, once asked, and says so', async () => {
    await multiApp(['vn.iclass', 'vn.ipro']);
    kiosk.clearAppData.mockResolvedValue({ cleared: ['vn.ipro'], missing: [], failed: [], permissionsLost: [] });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const renderer = await mountPin();

    await press(renderer, BUTTON);
    expect(texts(renderer)).toEqual(expect.arrayContaining(['iCLASS', 'iSMART Pro']));

    await press(renderer, 'iSMART Pro');
    await press(renderer, 'components.clearAppDataDialog.clear');
    expect(kiosk.clearAppData).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, , buttons] = alert.mock.calls[0] as [string, string, Array<{ style?: string; onPress?: () => void }>];
    expect(title).toBe('components.clearAppDataDialog.confirmTitle');

    await ReactTestRenderer.act(async () => {
      buttons.find((button) => button.style === 'destructive')!.onPress!();
    });
    await settle();

    expect(kiosk.clearAppData).toHaveBeenCalledWith(['vn.ipro']);
    expect(alert).toHaveBeenLastCalledWith('components.clearAppDataDialog.doneTitle', 'components.clearAppDataDialog.cleared');
    alert.mockRestore();
  });

  it('clears nothing when the question is turned down', async () => {
    await multiApp(['vn.iclass']);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const renderer = await mountPin();

    await press(renderer, BUTTON);
    // One app on the grid leaves nothing to choose: it is picked already
    await press(renderer, 'components.clearAppDataDialog.clear');
    const buttons = alert.mock.calls[0][2] as Array<{ style?: string; onPress?: () => void }>;
    await ReactTestRenderer.act(async () => {
      buttons.find((button) => button.style === 'cancel')?.onPress?.();
    });
    await settle();

    expect(kiosk.clearAppData).not.toHaveBeenCalled();
    alert.mockRestore();
  });
});
