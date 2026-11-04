/**
 * The name this tablet has on the management website, shown where the app would say "FreeKiosk",
 * so that one tablet among many can be told apart at a glance.
 *
 * Every heartbeat brings it, so a rename on the website reaches the screen by the next one. It
 * belongs to this tablet alone: it stays out of exportConfig and of backups, or a profile taken
 * from this tablet would rename all the others.
 */
import { useEffect, useState } from 'react';
import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { KEYS } from './storage';

export const PRODUCT_NAME = 'FreeKiosk';

const CHANGED_EVENT = 'FREEKIOSK_DISPLAY_NAME_CHANGED';

// Kept in memory: a heartbeat compares against it every 30 seconds. undefined: not read yet.
let known: string | null | undefined;

function publish(name: string | null): void {
  known = name;
  DeviceEventEmitter.emit(CHANGED_EVENT, name);
}

export const DeviceDisplayName = {
  /** The name given on the website, or null on a tablet that has none. */
  async current(): Promise<string | null> {
    if (known === undefined) {
      const stored = await AsyncStorage.getItem(KEYS.DEVICE_DISPLAY_NAME).catch(() => null);
      // A heartbeat may have answered while this was reading: what it brought is newer
      if (known === undefined) known = stored;
    }
    return known ?? null;
  },

  /** The device_name of a heartbeat. Another cloud sends none, and the tablet keeps what it has. */
  async observe(name: unknown): Promise<void> {
    const value = typeof name === 'string' ? name.trim() : '';
    if (!value || value === (await this.current())) return;
    await AsyncStorage.setItem(KEYS.DEVICE_DISPLAY_NAME, value);
    publish(value);
  },

  /** After enrolling or leaving, which remove the stored name along with every other setting. */
  forget(): void {
    publish(null);
  },
};

/** What to show as the title of a screen. Follows a rename while the screen is open. */
export function useDisplayName(): string {
  const [name, setName] = useState<string | null | undefined>(known);

  useEffect(() => {
    let mounted = true;
    DeviceDisplayName.current().then((value) => {
      if (mounted) setName(value);
    });
    const subscription = DeviceEventEmitter.addListener(CHANGED_EVENT, setName);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  // Blank while reading, for the moment that takes: better than a flash of the product name
  if (name === undefined) return '';
  return name ?? PRODUCT_NAME;
}
