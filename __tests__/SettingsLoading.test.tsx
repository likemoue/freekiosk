/**
 * Settings reads what is saved piece by piece, and the tabs used to show their defaults meanwhile:
 * right after the PIN, Web page turned into Apps and then into several apps. Nothing may show, or be
 * there to save, until it knows.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ActivityIndicator, Alert } from 'react-native';
import SettingsScreenNew from '../src/screens/settings/SettingsScreenNew';
import GeneralTab from '../src/screens/settings/tabs/GeneralTab';
import { grantSettingsAccess } from '../src/utils/authState';
import { StorageService } from '../src/utils/storage';

// jest.setup.js gives the camera its component only; Settings also listens for its devices
Object.assign(require('react-native-vision-camera').Camera, {
  addCameraDevicesChangedListener: () => ({ remove: () => {} }),
  getAvailableCameraDevices: () => [],
});

const navigation = { reset: jest.fn(), goBack: jest.fn(), navigate: jest.fn(), addListener: jest.fn(() => jest.fn()) } as any;
const settle = () => ReactTestRenderer.act(() => new Promise<void>((done) => setTimeout(() => done(), 800)));

describe('opening Settings', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;

  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    grantSettingsAccess();
  });

  afterEach(async () => {
    await ReactTestRenderer.act(async () => {
      renderer.unmount();
    });
    await settle();
    jest.restoreAllMocks();
  });

  it('shows the tab only once it holds what is saved, with no default on the way', async () => {
    await StorageService.saveDisplayMode('external_app');
    await StorageService.saveExternalAppMode('multi');

    // Reading what is saved starts here, and stays stuck until the test lets it go
    let finishReading: (value: string | null) => void = () => {};
    const reading = jest.spyOn(StorageService, 'getUrl').mockImplementation(
      () => new Promise<string | null>((done) => { finishReading = done; }) as any,
    );

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<SettingsScreenNew navigation={navigation} />);
    });
    expect(renderer.root.findAllByType(GeneralTab)).toHaveLength(0);
    expect(renderer.root.findAllByType(ActivityIndicator).length).toBeGreaterThan(0);

    reading.mockRestore();
    await ReactTestRenderer.act(async () => {
      finishReading('https://example.com/');
    });
    await settle();

    const [tab] = renderer.root.findAllByType(GeneralTab);
    expect(tab.props.displayMode).toBe('external_app');
    expect(tab.props.externalAppMode).toBe('multi');
  });

  it('shows the tab even if reading fails, rather than a spinner for ever', async () => {
    jest.spyOn(StorageService, 'getUrl').mockRejectedValue(new Error('storage is gone'));

    await ReactTestRenderer.act(async () => {
      renderer = ReactTestRenderer.create(<SettingsScreenNew navigation={navigation} />);
    });
    await settle();

    expect(renderer.root.findAllByType(GeneralTab)).toHaveLength(1);
  });
});
