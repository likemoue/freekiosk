/**
 * Where the tablet is, for the map of the management website (DeviceLocationModule.kt).
 *
 * Asked only when the website wants locations (location_wanted in the heartbeat answer): only then does
 * a Device Owner grant itself the permission and turn location on.
 */
import { NativeModules } from 'react-native';

export type LocationState = 'ok' | 'locating' | 'no_fix' | 'disabled' | 'no_permission' | 'no_provider' | 'error';

/** As the website takes it in a heartbeat, or in the result of the locate command */
export interface LocationReport {
  state: LocationState;
  latitude?: number;
  longitude?: number;
  accuracy_m?: number;
  /** How old the fix is when sent: the server dates it by its own clock, not the tablet's */
  age_ms?: number;
  provider?: string;
  message?: string;
}

const Native = NativeModules.DeviceLocation;

/** A fix older than this is renewed in the background, for the next heartbeat */
export const LOCATION_MAX_AGE_MS = 15 * 60_000;

export function canLocate(): boolean {
  return !!Native?.latest;
}

/** At once, never waiting for a fix: the heartbeat that asks must not be held up */
export async function latestLocation(maxAgeMs = LOCATION_MAX_AGE_MS): Promise<LocationReport | null> {
  if (!Native?.latest) return null;
  try {
    return await Native.latest(maxAgeMs);
  } catch {
    return null;
  }
}

/** A new fix, waiting up to timeoutMs; without one, the last known with its age */
export async function locateNow(timeoutMs = 40_000): Promise<LocationReport | null> {
  if (!Native?.locateNow) return null;
  try {
    return await Native.locateNow(timeoutMs);
  } catch {
    return null;
  }
}
