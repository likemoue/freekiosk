import clsx from 'clsx';
import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, Tv } from 'lucide-react';
import { timeAgo } from '../format';
import { Badge, Progress } from '../ui';
import { settingLabel } from './config';

export interface ProfileStatus {
  state: 'none' | 'match' | 'different' | 'pending' | 'not_reported';
  profile: { id: string; name: string } | null;
  source: 'device' | 'group' | null;
  groupProfile: { id: string; name: string } | null;
  differences: string[];
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

export function BatteryMeter({ level, charging }: { level: number | null; charging: boolean | null }) {
  if (level === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-soft">
        <Tv className="size-4" /> Không có pin
      </span>
    );
  }
  const tone = level > 50 ? 'ok' : level > 20 ? 'warn' : 'bad';
  const Icon = charging ? BatteryCharging : level > 70 ? BatteryFull : level > 25 ? BatteryMedium : BatteryLow;
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className={clsx('size-4', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'bad' && 'text-bad')} />
      <Progress value={level} tone={tone} className="w-14" />
      <span className="w-9 text-xs tabular-nums text-soft">{level}%</span>
    </span>
  );
}

export function deviceSubtitle(device: Pick<DeviceSummary, 'model' | 'manufacturer' | 'androidVersion'>): string {
  const model = [device.manufacturer, device.model].filter(Boolean).join(' ');
  return [model, device.androidVersion ? `Android ${device.androidVersion}` : null].filter(Boolean).join(' · ') || 'Chưa có thông tin';
}
