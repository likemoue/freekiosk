type Json = Record<string, unknown>;

export interface ConfigDifference {
  /** Like general.url */
  path: string;
  wanted: unknown;
  reported: unknown;
}

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const isBlank = (value: unknown): boolean => value === null || value === undefined || value === '';

/** What a device must have for a value to count as the same: what it adds on its own does not matter */
function sameValue(wanted: unknown, reported: unknown): boolean {
  if (isBlank(wanted) && isBlank(reported)) return true;
  if (typeof wanted === 'number' && typeof reported === 'number') return Math.abs(wanted - reported) < 1e-6;
  if (Array.isArray(wanted) && Array.isArray(reported)) {
    if (wanted.length !== reported.length) return false;
    // The same things in another order are the same setting
    const left = wanted.map((v) => JSON.stringify(v)).sort();
    const right = reported.map((v) => JSON.stringify(v)).sort();
    return left.every((v, i) => v === right[i]) || wanted.every((v) => reported.some((r) => sameValue(v, r)));
  }
  if (isObject(wanted) && isObject(reported)) return Object.keys(wanted).every((key) => sameValue(wanted[key], reported[key]));
  return wanted === reported;
}

/**
 * Where a device's configuration is not what the profile says. Only what the profile sets counts:
 * "only the items you set are applied" is how a profile works, so anything else on the device is its own.
 */
export function configDifferences(wanted: unknown, reported: unknown, prefix = ''): ConfigDifference[] {
  if (!isObject(wanted)) return [];
  const out: ConfigDifference[] = [];
  const device = isObject(reported) ? reported : {};
  for (const [key, value] of Object.entries(wanted)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isObject(value)) out.push(...configDifferences(value, device[key], path));
    else if (!sameValue(value, device[key])) out.push({ path, wanted: value, reported: device[key] ?? null });
  }
  return out;
}

export type ProfileState = 'none' | 'match' | 'different' | 'pending' | 'not_reported';

interface ProfileRef {
  id: string;
  name: string;
  config: unknown;
}

export interface DeviceForProfile {
  profile?: ProfileRef | null;
  group?: { profile?: ProfileRef | null } | null;
  reportedConfig: unknown;
  pendingConfig: unknown;
  pendingSensitiveEnc?: string | null;
}

export interface ProfileStatus {
  state: ProfileState;
  profile: { id: string; name: string } | null;
  /** A profile set on the device wins over the one of its group */
  source: 'device' | 'group' | null;
  /** The device has a profile of its own that is not the one of its group */
  groupProfile: { id: string; name: string } | null;
  /** The paths that differ */
  differences: string[];
}

export function profileStatus(device: DeviceForProfile): ProfileStatus {
  const own = device.profile ?? null;
  const ofGroup = device.group?.profile ?? null;
  const profile = own ?? ofGroup;
  const groupProfile = own && ofGroup && own.id !== ofGroup.id ? { id: ofGroup.id, name: ofGroup.name } : null;
  if (!profile) return { state: 'none', profile: null, source: null, groupProfile: null, differences: [] };

  const base = { profile: { id: profile.id, name: profile.name }, source: own ? ('device' as const) : ('group' as const), groupProfile };
  if (device.pendingConfig !== null && device.pendingConfig !== undefined) return { ...base, state: 'pending', differences: [] };
  if (device.pendingSensitiveEnc) return { ...base, state: 'pending', differences: [] };
  if (!isObject(device.reportedConfig)) return { ...base, state: 'not_reported', differences: [] };
  const differences = configDifferences(profile.config, device.reportedConfig).map((d) => d.path);
  return { ...base, state: differences.length ? 'different' : 'match', differences };
}
