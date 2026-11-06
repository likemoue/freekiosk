/**
 * FreeKiosk - device capability reporting
 *
 * Computes the list of capabilities this device actually supports, so the cloud
 * dashboard can show only the actions that can really run (see the cloud's
 * `device-feature-audit.md` for the authoritative feature/DO matrix, and
 * `command_sender_script.html` `capabilityMap` for the commands gated on them).
 *
 * The list is sent at enrollment (device_info.capabilities) and refreshed on
 * every heartbeat (app.capabilities), so granting a permission later updates the
 * dashboard on the next tick. An empty list is treated by the cloud as a legacy
 * device (show everything), so we always report at least the baseline set.
 */
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

import KioskModule from './KioskModule';
import AccessibilityModule from './AccessibilityModule';
import OverlayPermissionModule from './OverlayPermissionModule';
import { canLocate } from './DeviceLocation';
import { canPullApk } from './ApkExport';
import ManagedAppInstaller from './ManagedAppInstaller';

// Capability vocabulary. Keep in sync with the cloud (device-feature-audit.md).
export type Capability =
  // Baseline: available on any FreeKiosk install, no special access
  | 'brightness'
  | 'volume'
  | 'screen'
  | 'reload'
  | 'screenshot'
  | 'audio'
  | 'tts'
  | 'toast'
  | 'url'
  // A cloud playlist can hold web pages and YouTube videos: the dashboard warns when an older app cannot
  | 'signage_web'
  | 'signage_youtube'
  // Tells a tablet that can from one that needs updating. The tablet says so itself if it lacks the right to.
  | 'screen_timeout'
  | 'set_volume'
  // Plays a cloud playlist in step with the other screens
  | 'signage_sync'
  // Device Owner gated
  | 'device_owner'
  | 'reboot'
  | 'silent_install'
  // Several APKs of one app in one install: tells a tablet that can from one that needs updating
  | 'split_install'
  // Closing every app takes hiding them, which only a Device Owner can do
  | 'stop_apps'
  // A Device Owner on Android 9 and up can clear the data of another app
  | 'clear_app_data'
  | 'screen_off_lock'
  // Special-access / runtime permission gated
  | 'accessibility'
  | 'overlay'
  | 'usage_access'
  | 'camera'
  | 'location'
  // Places itself on the map of the management website when asked (DeviceLocationModule)
  | 'locate'
  // Removes apps with no prompt, as a Device Owner
  | 'uninstall_app'
  // Sends the APK of an installed app to the library of the website (ApkExportModule)
  | 'pull_apk'
  // Shows its screen live on the website, and takes taps from it (LiveScreen.kt)
  | 'remote_view'
  | 'bluetooth';

const BASELINE: Capability[] = [
  'brightness',
  'volume',
  'screen',
  'reload',
  'screenshot',
  'audio',
  'tts',
  'toast',
  'url',
  'signage_web',
  'signage_youtube',
  'screen_timeout',
  'set_volume',
  'signage_sync',
];

async function safe<T>(p: Promise<T> | undefined, fallback: T): Promise<T> {
  try {
    return p ? await p : fallback;
  } catch {
    return fallback;
  }
}

async function hasRuntimePermission(perm: string): Promise<boolean> {
  try {
    return await PermissionsAndroid.check(perm as any);
  } catch {
    return false;
  }
}

/**
 * Build the capability list from the device's real state. Best-effort: any
 * individual probe that throws is simply treated as "not supported".
 */
export async function getCapabilities(): Promise<string[]> {
  if (Platform.OS !== 'android') {
    return [...BASELINE];
  }

  const caps = new Set<Capability>(BASELINE);

  const isDeviceOwner = await safe(KioskModule?.isDeviceOwner(), false);
  if (isDeviceOwner) {
    // Reboot, silent APK install and a true screen-off lock all require the
    // Device Policy Manager, i.e. Device Owner (see audit).
    caps.add('device_owner');
    caps.add('reboot');
    caps.add('silent_install');
    caps.add('split_install');
    caps.add('stop_apps');
    if (Number(Platform.Version) >= 28) caps.add('clear_app_data');
    if (ManagedAppInstaller.canUninstall()) caps.add('uninstall_app');
    caps.add('screen_off_lock');
  }

  // Accessibility can be enabled programmatically when Device Owner, otherwise
  // it depends on the user having toggled the service on.
  const accessibilityEnabled = await safe(
    AccessibilityModule?.isAccessibilityServiceEnabled(),
    false,
  );
  if (isDeviceOwner || accessibilityEnabled) {
    caps.add('accessibility');
  }

  if (await safe(OverlayPermissionModule?.canDrawOverlays(), false)) {
    caps.add('overlay');
  }
  if (await safe(KioskModule?.hasUsageStatsPermission(), false)) {
    caps.add('usage_access');
  }

  const P = PermissionsAndroid.PERMISSIONS;
  if (await hasRuntimePermission(P.CAMERA)) {
    caps.add('camera');
  }
  if (await hasRuntimePermission(P.ACCESS_FINE_LOCATION)) {
    caps.add('location');
  }
  // Grants itself what it lacks when asked: told apart from an older app, which reports 'location' too
  if (canLocate()) {
    caps.add('locate');
  }
  if (canPullApk()) {
    caps.add('pull_apk');
    // Same version: the live screen came with it. Whether the hand works, the screen says itself
    caps.add('remote_view');
  }
  if (P.BLUETOOTH_CONNECT && (await hasRuntimePermission(P.BLUETOOTH_CONNECT))) {
    caps.add('bluetooth');
  }

  return Array.from(caps);
}

// Small guard so callers can avoid pulling native modules on non-android.
export const isSupportedPlatform = Platform.OS === 'android' && !!NativeModules.KioskModule;
