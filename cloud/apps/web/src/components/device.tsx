import clsx from 'clsx';
import { Tv } from 'lucide-react';
import { timeAgo } from '../format';
import { Badge } from '../ui';
import { settingLabel } from './config';

export interface ProfileStatus {
  state: 'none' | 'match' | 'different' | 'pending' | 'not_reported';
  profile: { id: string; name: string } | null;
  source: 'device' | 'group' | null;
  groupProfile: { id: string; name: string } | null;
  differences: string[];
}

/** Where the tablet last placed itself; the time is the server's */
export interface DeviceLocation {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  at: string;
  provider: string | null;
}

export interface DeviceSummary {
  id: string;
  name: string;
  notes: string | null;
  group: { id: string; name: string; color: string | null; profile?: { id: string; name: string } | null } | null;
  profile: { id: string; name: string } | null;
  profileStatus: ProfileStatus;
  playlist: { id: string; name: string } | null;
  model: string | null;
  manufacturer: string | null;
  androidVersion: string | null;
  appVersion: string | null;
  formFactor: string;
  capabilities: string[];
  online: boolean;
  lastSeenAt: string | null;
  publicIp: string | null;
  batteryLevel: number | null;
  batteryCharging: boolean | null;
  screenOn: boolean | null;
  brightness: number | null;
  wifiSsid: string | null;
  wifiSignalDbm: number | null;
  ethernet: boolean | null;
  ipAddress: string | null;
  currentUrl: string | null;
  kioskMode: boolean | null;
  deviceOwner: boolean | null;
  freeStorageMb: number | null;
  freeMemoryMb: number | null;
  uptimeSeconds: number | null;
  timezone: string | null;
  location: DeviceLocation | null;
  /** ok, locating, no_fix, disabled, no_permission, no_provider, error; null: never said */
  locationState: string | null;
  configPending: boolean;
  forceUnenroll: boolean;
  enrolledAt: string;
  unenrolledAt: string | null;
}

const PROFILE_BADGE: Record<Exclude<ProfileStatus['state'], 'none'>, { label: string; tone: 'ok' | 'warn' | 'info' | 'neutral' }> = {
  match: { label: 'Khớp', tone: 'ok' },
  different: { label: 'Lệch', tone: 'warn' },
  pending: { label: 'Đang gửi', tone: 'info' },
  not_reported: { label: 'Chưa báo', tone: 'neutral' },
};

/** Which profile a device uses, and whether its settings still are what the profile says */
export function ProfileCell({ status }: { status: ProfileStatus }) {
  if (!status.profile) return <span className="text-soft">Không có</span>;
  const badge = PROFILE_BADGE[status.state as keyof typeof PROFILE_BADGE];
  const why = status.state === 'different' ? `Khác hồ sơ ở: ${status.differences.map(settingLabel).join(', ')}` : undefined;
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span className="max-w-44 truncate" title={status.profile.name}>{status.profile.name}</span>
      <span className="flex flex-wrap gap-1">
        <Badge tone={badge.tone} title={why}>{badge.label}{status.state === 'different' ? ` ${status.differences.length} mục` : ''}</Badge>
        {status.groupProfile && <Badge tone="warn" title={`Nhóm của máy này dùng hồ sơ ${status.groupProfile.name}`}>Khác nhóm</Badge>}
      </span>
    </span>
  );
}

export function StatusDot({ online }: { online: boolean }) {
  return <span className={clsx('inline-block size-2.5 shrink-0 rounded-full', online ? 'bg-emerald-500 shadow-[0_0_0_3px_rgb(16_185_129/0.18)]' : 'bg-rose-500')} />;
}

export function DeviceState({ device }: { device: Pick<DeviceSummary, 'online' | 'lastSeenAt' | 'unenrolledAt' | 'forceUnenroll'> }) {
  if (device.unenrolledAt) return <Badge tone="neutral">Đã hủy đăng ký</Badge>;
  if (device.forceUnenroll) return <Badge tone="warn">Chờ hủy đăng ký</Badge>;
  if (device.online) return <Badge tone="ok">Trực tuyến</Badge>;
  if (!device.lastSeenAt) return <Badge tone="info">Chưa kết nối</Badge>;
  return <Badge tone="bad" title={`Tín hiệu cuối: ${timeAgo(device.lastSeenAt)}`}>Ngoại tuyến</Badge>;
}

/**
 * The battery of a tablet as one picture: a battery whose inside fills to the level, in the color of the level,
 * with a bolt over it while it charges. It replaced a 16-pixel icon in front of a bar, whose charging battery
 * (two halves around a bolt) read as "∞", and which the table could squeeze smaller still.
 */
export function BatteryMeter({ level, charging }: { level: number | null; charging: boolean | null }) {
  if (level === null) {
    return (
      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-soft">
        <Tv className="size-4 shrink-0" /> Không có pin
      </span>
    );
  }
  const tone = level > 50 ? 'ok' : level > 20 ? 'warn' : 'bad';
  const inside = level <= 0 ? 0 : Math.max(1.5, (18 * Math.min(100, level)) / 100);
  const label = charging ? `Pin ${level}%, đang sạc` : `Pin ${level}%`;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={label}>
      <svg viewBox="0 0 26 14" className="h-4 w-[30px] shrink-0" role="img" aria-label={label}>
        <rect x="0.75" y="0.75" width="21.5" height="12.5" rx="3" fill="none" strokeWidth="1.5" className="stroke-soft" />
        <rect x="23.25" y="4.5" width="2" height="5" rx="1" className="fill-soft" />
        {inside > 0 && (
          <rect x="2.5" y="2.5" width={inside} height="9" rx="1.5" className={clsx(tone === 'ok' && 'fill-ok', tone === 'warn' && 'fill-warn', tone === 'bad' && 'fill-bad')} />
        )}
        {/* In the color of the text, edged in the card's, so that it stands out on the fill and on the empty part alike */}
        {charging && <path d="M13 1.6 8.2 7.8h3.3L10 12.4l4.8-6.2h-3.3z" strokeWidth="1" strokeLinejoin="round" className="fill-ink stroke-card" />}
      </svg>
      <span className="w-9 text-xs tabular-nums text-soft">{level}%</span>
    </span>
  );
}

const LOCATION_MISSING: Record<string, string> = {
  locating: 'Đang lấy vị trí lần đầu',
  no_fix: 'Chưa định vị được: Android không tìm ra vị trí từ mạng Wi-Fi quanh máy',
  disabled: 'Dịch vụ vị trí đang tắt và máy không tự bật được',
  no_permission: 'FreeKiosk chưa có quyền vị trí (cần Device Owner)',
  no_provider: 'Máy không có nguồn vị trí nào đang bật',
  error: 'Máy báo lỗi khi lấy vị trí',
};

/** Why a tablet is not on the map, in a line */
export function locationMissing(device: Pick<DeviceSummary, 'locationState' | 'capabilities' | 'online' | 'lastSeenAt'>): string {
  if (device.locationState && LOCATION_MISSING[device.locationState]) return LOCATION_MISSING[device.locationState];
  if (!device.lastSeenAt) return 'Chưa kết nối';
  if (device.capabilities.length > 0 && !device.capabilities.includes('locate')) return 'Cần FreeKiosk bản mới nhất';
  return device.online ? 'Chưa báo vị trí' : 'Chưa báo vị trí, máy đang ngoại tuyến';
}

/** "±30 m": how far the place may be off */
export function accuracyText(location: Pick<DeviceLocation, 'accuracyM'>): string | null {
  if (location.accuracyM === null) return null;
  return location.accuracyM >= 1000 ? `±${(location.accuracyM / 1000).toFixed(1).replace('.', ',')} km` : `±${Math.round(location.accuracyM)} m`;
}

export function deviceSubtitle(device: Pick<DeviceSummary, 'model' | 'manufacturer' | 'androidVersion'>): string {
  const model = [device.manufacturer, device.model].filter(Boolean).join(' ');
  return [model, device.androidVersion ? `Android ${device.androidVersion}` : null].filter(Boolean).join(' · ') || 'Chưa có thông tin';
}
