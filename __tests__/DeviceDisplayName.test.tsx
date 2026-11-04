/**
 * The name on the management website replaces "FreeKiosk" on the home screens, so that one tablet
 * among many can be told apart:
 *
 *   - a rename reaches a screen that is already open
 *   - a tablet with no name, or on a cloud that sends none, says FreeKiosk as before
 *   - the name stays out of the exported configuration: a profile taken from one tablet is pushed
 *     to many, and must not give them all the same name
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Text } from 'react-native';
import ExternalAppOverlay from '../src/components/ExternalAppOverlay';
import WebViewComponent from '../src/components/WebViewComponent';
import { StorageService } from '../src/utils/storage';
import { DeviceDisplayName, PRODUCT_NAME } from '../src/utils/DeviceDisplayName';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
}));

const KEY = '@cloud_device_display_name';
const ICLASS = { packageName: 'ismart.edu.vn.iclass', displayName: 'iCLASS', showOnHomeScreen: true } as any;

const noop = () => {};
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function mountOverlay(mode: 'single' | 'multi') {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ExternalAppOverlay
        externalAppPackage={ICLASS.packageName}
        managedApps={[ICLASS]}
        externalAppMode={mode}
        isAppLaunched={false}
        backButtonMode="immediate"
        onReturnToApp={noop}
        onGoToSettings={noop}
      />,
    );
  });
  mounted.push(renderer!);
  return renderer!;
}

const texts = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((node) => node.props.children);

const observe = (name: unknown) =>
  ReactTestRenderer.act(async () => {
    await DeviceDisplayName.observe(name);
  });

describe('the name of the tablet on its home screen', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    DeviceDisplayName.forget();
  });

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      mounted.splice(0).forEach((renderer) => renderer.unmount());
    });
  });

  it('says FreeKiosk on a tablet the website has not named', async () => {
    expect(texts(await mountOverlay('multi'))).toContain(PRODUCT_NAME);
  });

  it('shows the name instead, on the app grid and on the single app screen', async () => {
    await DeviceDisplayName.observe('Lớp 5A - Máy 1');
    for (const mode of ['multi', 'single'] as const) {
      const shown = texts(await mountOverlay(mode));
      expect(shown).toContain('Lớp 5A - Máy 1');
      expect(shown).not.toContain(PRODUCT_NAME);
    }
  });

  it('shows the name on the welcome screen of a tablet with no page set', async () => {
    await DeviceDisplayName.observe('Lớp 5A - Máy 1');
    let renderer: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<WebViewComponent url="" autoReload={false} />);
    });
    mounted.push(renderer!);
    const shown = texts(renderer!);
    expect(shown).toContain('Lớp 5A - Máy 1');
    expect(shown).not.toContain(PRODUCT_NAME);
  });

  it('follows a rename while the screen is open', async () => {
    const renderer = await mountOverlay('multi');
    await observe('Lớp 5A - Máy 1');
    expect(texts(renderer)).toContain('Lớp 5A - Máy 1');
    await observe('Lớp 5B - Máy 1');
    expect(texts(renderer)).toContain('Lớp 5B - Máy 1');
    expect(texts(renderer)).not.toContain('Lớp 5A - Máy 1');
  });

  it('goes back to FreeKiosk once the tablet has left the website', async () => {
    const renderer = await mountOverlay('multi');
    await observe('Lớp 5A - Máy 1');
    await ReactTestRenderer.act(async () => {
      DeviceDisplayName.forget();
    });
    expect(texts(renderer)).toContain(PRODUCT_NAME);
  });

  it('keeps what it has when a heartbeat brings no usable name', async () => {
    await DeviceDisplayName.observe('Lớp 5A - Máy 1');
    for (const nothing of [undefined, null, '', '   ', 42]) {
      await DeviceDisplayName.observe(nothing);
    }
    expect(await DeviceDisplayName.current()).toBe('Lớp 5A - Máy 1');
  });

  it('writes to storage only when the name changes, not every 30 seconds', async () => {
    const write = AsyncStorage.setItem as jest.Mock;
    write.mockClear();
    await DeviceDisplayName.observe('  Lớp 5A - Máy 1 ');
    await DeviceDisplayName.observe('Lớp 5A - Máy 1');
    expect(write).toHaveBeenCalledTimes(1);
    expect(await AsyncStorage.getItem(KEY)).toBe('Lớp 5A - Máy 1');
  });

  it('stays out of the configuration a profile is taken from', async () => {
    await DeviceDisplayName.observe('Lớp 5A - Máy 1');
    expect(JSON.stringify(await StorageService.exportConfig())).not.toContain('Lớp 5A');
  });
});

describe('the name after a restart', () => {
  it('is read back from storage', async () => {
    await AsyncStorage.setItem(KEY, 'Lớp 5A - Máy 1');
    let restarted: typeof DeviceDisplayName;
    jest.isolateModules(() => {
      // A new copy of the module, as after a restart, with the same storage behind it
      jest.doMock('@react-native-async-storage/async-storage', () => AsyncStorage);
      restarted = require('../src/utils/DeviceDisplayName').DeviceDisplayName;
    });
    expect(restarted!).not.toBe(DeviceDisplayName);
    expect(await restarted!.current()).toBe('Lớp 5A - Máy 1');
  });
});
