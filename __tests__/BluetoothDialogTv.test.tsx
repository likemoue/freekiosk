/**
 * Turning Bluetooth off from the lock-screen dialog: on a TV it asks first (the remote is
 * usually Bluetooth), anywhere else it acts at once as it always did. Turning it on never asks.
 */
import React from 'react';
import { Alert, Platform, Switch } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockSetEnabled = jest.fn();
let mockEnabled = true;

const { NativeModules } = require('react-native');
NativeModules.BluetoothControlModule = {
  getBluetoothInfo: jest.fn(async () => ({ isEnabled: mockEnabled, bondedDevices: [] })),
  setBluetoothEnabled: (...args: any[]) => mockSetEnabled(...args),
};

const BluetoothDialog = require('../src/components/BluetoothDialog').default;

const setTv = (value: boolean) =>
  Object.defineProperty(Platform, 'isTV', { configurable: true, get: () => value });

let mounted: ReactTestRenderer.ReactTestRenderer | null = null;

const render = async () => {
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = ReactTestRenderer.create(<BluetoothDialog visible onClose={() => {}} />);
  });
  mounted = renderer;
  return renderer;
};
const toggle = async (r: ReactTestRenderer.ReactTestRenderer) => {
  await act(async () => {
    r.root.findByType(Switch).props.onValueChange(!mockEnabled);
  });
};

describe('BluetoothDialog toggle', () => {
  const original = Platform.isTV;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    // Toggling polls the Bluetooth state on a timer for seconds after a test is over. On real
    // timers that poll re-renders once Jest has torn this file down, and the error then fails
    // whichever suite the worker is running by that time.
    jest.useFakeTimers();
    mockSetEnabled.mockReset();
    mockSetEnabled.mockResolvedValue({ success: true });
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => {
    act(() => { mounted?.unmount(); });
    mounted = null;
    jest.clearAllTimers();
    jest.useRealTimers();
    alertSpy.mockRestore();
    Object.defineProperty(Platform, 'isTV', { configurable: true, get: () => original });
  });

  it('asks before turning Bluetooth off on a TV, and does nothing until confirmed', async () => {
    setTv(true);
    mockEnabled = true;
    const r = await render();
    await toggle(r);
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0][0]).toBe('components.bluetoothDialog.tvOffTitle');
    expect(mockSetEnabled).not.toHaveBeenCalled();

    const buttons = alertSpy.mock.calls[0][2];
    await act(async () => {
      buttons.find((b: any) => b.style === 'destructive').onPress();
    });
    expect(mockSetEnabled).toHaveBeenCalledWith(false);
  });

  it('does not ask on a tablet: it turns Bluetooth off at once', async () => {
    setTv(false);
    mockEnabled = true;
    const r = await render();
    await toggle(r);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockSetEnabled).toHaveBeenCalledWith(false);
  });

  it('does not ask to turn Bluetooth on, even on a TV', async () => {
    setTv(true);
    mockEnabled = false;
    const r = await render();
    await toggle(r);
    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockSetEnabled).toHaveBeenCalledWith(true);
  });
});
