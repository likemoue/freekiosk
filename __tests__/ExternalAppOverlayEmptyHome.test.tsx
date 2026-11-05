/**
 * Multi App mode with no app on the home screen is a valid setup: the grid stays home, with nothing
 * in it. It used to fall through to the single-app screen, which waits for an app that never comes.
 * Settings has to stay reachable from there, or an empty tablet could not be set up.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, View } from 'react-native';
import ExternalAppOverlay from '../src/components/ExternalAppOverlay';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
}));

// i18n is not started here, so a string shows as its key
const NO_APPS = 'components.externalAppOverlay.noApps';
const WAITING = 'components.externalAppOverlay.waiting';
const RETURN_TO_APP = 'components.externalAppOverlay.returnToApp';

const ICLASS = { packageName: 'ismart.edu.vn.iclass', displayName: 'iCLASS', showOnHomeScreen: true, launchOnBoot: false, keepAlive: false, allowAccessibility: false };
const noop = () => {};
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];

async function mount(apps: typeof ICLASS[], onGoToSettings: () => void = noop, isAppLaunched = false) {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <ExternalAppOverlay
        externalAppPackage=""
        managedApps={apps}
        externalAppMode="multi"
        isAppLaunched={isAppLaunched}
        backButtonMode="immediate"
        onReturnToApp={noop}
        onGoToSettings={onGoToSettings}
      />,
    );
  });
  mounted.push(renderer!);
  return renderer!;
}

const texts = (renderer: ReactTestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((node) => node.props.children);

afterEach(async () => {
  await ReactTestRenderer.act(async () => {
    mounted.splice(0).forEach((renderer) => renderer.unmount());
  });
});

describe('a home screen with no apps', () => {
  it('says so calmly, instead of waiting for an app or offering to return to one', async () => {
    const shown = texts(await mount([]));
    expect(shown).toContain(NO_APPS);
    expect(shown).not.toContain(WAITING);
    expect(shown).not.toContain(RETURN_TO_APP);
  });

  it('counts an app kept off the home screen as no app', async () => {
    const shown = texts(await mount([{ ...ICLASS, showOnHomeScreen: false }]));
    expect(shown).toContain(NO_APPS);
  });

  it('still leads to Settings with the usual taps', async () => {
    const onGoToSettings = jest.fn();
    const renderer = await mount([], onGoToSettings);
    const home = renderer.root.findAllByType(View).find((node) => node.props.onTouchStart);
    for (let tap = 0; tap < 5; tap++) {
      await ReactTestRenderer.act(async () => {
        home!.props.onTouchStart({ nativeEvent: { pageX: 100, pageY: 100 } });
      });
    }
    expect(onGoToSettings).toHaveBeenCalledTimes(1);
  });

  it('is never a blank screen, even if it believes an app is still open', async () => {
    const renderer = await mount([], noop, true);
    expect(texts(renderer)).toContain(NO_APPS);
    expect(renderer.root.findAllByType(View).some((node) => node.props.onTouchStart)).toBe(true);
  });

  it('says nothing of the sort once there is an app', async () => {
    const shown = texts(await mount([ICLASS]));
    expect(shown).not.toContain(NO_APPS);
  });
});
