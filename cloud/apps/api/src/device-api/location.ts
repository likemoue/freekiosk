import type { Device } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';

/**
 * What a tablet says of where it is (DeviceLocationModule.kt in the app), in a heartbeat or as the result
 * of the locate command. Only the last place is kept: no trail.
 */
export const LOCATION_STATES = ['ok', 'locating', 'no_fix', 'disabled', 'no_permission', 'no_provider', 'error'] as const;

/** Why a tablet is not on the map, in the words of the history and the map */
export const LOCATION_STATE_TEXT: Record<string, string> = {
  locating: 'Máy đang lấy vị trí lần đầu',
  no_fix: 'Máy chưa lấy được vị trí: Android không định vị được từ mạng Wi-Fi quanh máy',
  disabled: 'Dịch vụ vị trí đang tắt trên máy và máy không tự bật được (cần Device Owner, Android 11 trở lên)',
  no_permission: 'FreeKiosk chưa có quyền vị trí và không tự cấp được (cần Device Owner)',
  no_provider: 'Máy không có nguồn vị trí nào đang bật',
  error: 'Máy báo lỗi khi lấy vị trí',
};

const MAX_AGE_MS = 365 * 86_400_000;

type Json = Record<string, unknown>;

const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/**
 * The columns to write. A fix is dated by the server's clock from its age, as a tablet's clock may be
 * off. One older than the place kept leaves that place: a fix comes again and again, older each time.
 */
export function locationColumns(device: Pick<Device, 'locationAt'>, report: Json, now = new Date()): Prisma.DeviceUpdateInput {
  const state = typeof report.state === 'string' ? report.state : undefined;
  if (!state || !(LOCATION_STATES as readonly string[]).includes(state)) return {};
  if (state !== 'ok') return { locationState: state };

  const latitude = num(report.latitude);
  const longitude = num(report.longitude);
  // 0, 0 is what a broken provider says: nobody puts a kiosk in the Gulf of Guinea
  if (latitude === undefined || longitude === undefined || Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || (latitude === 0 && longitude === 0)) {
    return { locationState: 'error' };
  }
  const age = Math.min(Math.max(num(report.age_ms) ?? 0, 0), MAX_AGE_MS);
  const at = new Date(now.getTime() - age);
  if (device.locationAt && at.getTime() < device.locationAt.getTime() - 1_000) return { locationState: 'ok' };

  const accuracy = num(report.accuracy_m);
  const provider = typeof report.provider === 'string' && report.provider ? report.provider.slice(0, 20) : null;
  return {
    latitude,
    longitude,
    locationAccuracyM: accuracy !== undefined && accuracy >= 0 ? Math.round(accuracy * 10) / 10 : null,
    locationAt: at,
    locationProvider: provider,
    locationState: 'ok',
  };
}

/** The place as the website shows it, or null when the tablet never gave one */
export function locationView(device: Pick<Device, 'latitude' | 'longitude' | 'locationAccuracyM' | 'locationAt' | 'locationProvider'>) {
  if (device.latitude === null || device.longitude === null || !device.locationAt) return null;
  return {
    latitude: device.latitude,
    longitude: device.longitude,
    accuracyM: device.locationAccuracyM,
    at: device.locationAt,
    provider: device.locationProvider,
  };
}

/** Clearing every place kept, when the website stops asking */
export const NO_LOCATION = {
  latitude: null,
  longitude: null,
  locationAccuracyM: null,
  locationAt: null,
  locationProvider: null,
  locationState: null,
} satisfies Prisma.DeviceUpdateManyMutationInput;
