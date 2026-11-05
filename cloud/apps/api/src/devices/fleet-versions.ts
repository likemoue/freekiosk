import { generalOf, managedAppsOf } from './home-apps';

export const OWN_PACKAGE = 'com.freekiosk';

export interface FleetDevice {
  id: string;
  name: string;
  online: boolean;
  appVersion: string | null;
  installedApps: unknown;
  reportedConfig: unknown;
  pendingConfig: unknown;
}

export interface LibraryApk {
  id: string;
  fileName: string;
  packageName: string | null;
  versionName: string | null;
  versionCode: number | null;
  createdAt: Date;
  /** Android could install it as it is */
  installable: boolean;
}

interface DeviceRef {
  id: string;
  name: string;
  online: boolean;
}

export interface VersionGroup {
  versionCode: number | null;
  versionName: string | null;
  /** Older than the newest one in the library */
  behind: boolean;
  /** Newer than anything in the library */
  ahead: boolean;
  devices: DeviceRef[];
}

export interface AppVersions {
  packageName: string;
  label: string;
  latest: { apkId: string; fileName: string; versionName: string | null; versionCode: number | null } | null;
  /** Newest first */
  versions: VersionGroup[];
  /** Reported its apps, and this one is not among them */
  missing: DeviceRef[];
  /** Has not reported its apps yet */
  notReported: DeviceRef[];
  /** mixed: the tablets do not all have one version. behind: they do, and the library has a newer one */
  state: 'same' | 'mixed' | 'behind' | 'none';
}

interface Installed {
  package: string;
  version_code?: number;
  version_name?: string;
}

const byName = new Intl.Collator('vi', { numeric: true });
const refOf = (device: FleetDevice): DeviceRef => ({ id: device.id, name: device.name, online: device.online });

function installedOf(device: FleetDevice): Installed[] | null {
  if (!Array.isArray(device.installedApps) || device.installedApps.length === 0) return null;
  return device.installedApps.filter((app): app is Installed => !!app && typeof app === 'object' && typeof (app as Installed).package === 'string');
}

/** The newest that can be installed. FreeKiosk goes for the build tablets update to, as in latestAppUpdate */
function newestOf(apks: LibraryApk[]): LibraryApk | null {
  const usable = apks.filter((apk) => apk.installable);
  if (!usable.length) return null;
  const top = Math.max(...usable.map((apk) => apk.versionCode ?? 0));
  const builds = usable.filter((apk) => (apk.versionCode ?? 0) === top).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return builds.find((apk) => !/cloudprovi/i.test(apk.fileName)) ?? builds[0];
}

/**
 * Which version of each app the tablets have, for the apps someone looks after: those in the library
 * and those on a home screen. What came with the tablet (a browser, a camera) updates by itself and
 * differs from model to model, which says nothing is wrong.
 */
export function fleetVersions(devices: FleetDevice[], apks: LibraryApk[], labels: Map<string, string>): AppVersions[] {
  const installedBy = new Map(devices.map((device) => [device.id, installedOf(device)]));
  const packages = new Set<string>([OWN_PACKAGE]);
  for (const apk of apks) if (apk.packageName) packages.add(apk.packageName);
  for (const device of devices) {
    for (const app of managedAppsOf(generalOf({ reportedConfig: device.reportedConfig, pendingConfig: device.pendingConfig }))) packages.add(app.packageName);
  }

  const rows = [...packages].map((packageName): AppVersions => {
    const library = apks.filter((apk) => apk.packageName === packageName);
    const newest = newestOf(library);
    const nameOfCode = (code: number | null) => library.find((apk) => apk.versionCode === code)?.versionName ?? null;
    const groups = new Map<string, VersionGroup>();
    const missing: DeviceRef[] = [];
    const notReported: DeviceRef[] = [];

    const add = (key: string, versionCode: number | null, versionName: string | null, device: FleetDevice) => {
      const group = groups.get(key) ?? { versionCode, versionName, behind: false, ahead: false, devices: [] };
      group.versionName = group.versionName ?? versionName;
      group.devices.push(refOf(device));
      groups.set(key, group);
    };

    for (const device of devices) {
      if (packageName === OWN_PACKAGE) {
        // FreeKiosk does not list itself: every heartbeat says which version it is
        if (!device.appVersion) notReported.push(refOf(device));
        else add(device.appVersion, library.find((apk) => apk.versionName === device.appVersion)?.versionCode ?? null, device.appVersion, device);
        continue;
      }
      const installed = installedBy.get(device.id);
      if (!installed) {
        notReported.push(refOf(device));
        continue;
      }
      const app = installed.find((item) => item.package === packageName);
      if (!app) {
        missing.push(refOf(device));
        continue;
      }
      const code = typeof app.version_code === 'number' ? app.version_code : null;
      add(String(code), code, app.version_name ?? nameOfCode(code), device);
    }

    const versions = [...groups.values()];
    for (const group of versions) {
      if (!newest) continue;
      const order = group.versionCode !== null && newest.versionCode !== null
        ? group.versionCode - newest.versionCode
        : packageName === OWN_PACKAGE ? byName.compare(group.versionName ?? '', newest.versionName ?? '') : 0;
      group.behind = order < 0;
      group.ahead = order > 0;
    }
    versions.sort((a, b) =>
      a.versionCode !== null && b.versionCode !== null ? b.versionCode - a.versionCode : byName.compare(b.versionName ?? '', a.versionName ?? ''),
    );
    for (const group of versions) group.devices.sort((a, b) => byName.compare(a.name, b.name));

    const state = versions.length === 0 ? 'none' : versions.length > 1 ? 'mixed' : versions[0].behind ? 'behind' : 'same';
    return {
      packageName,
      label: packageName === OWN_PACKAGE ? 'FreeKiosk' : labels.get(packageName) ?? packageName,
      latest: newest ? { apkId: newest.id, fileName: newest.fileName, versionName: newest.versionName, versionCode: newest.versionCode } : null,
      versions,
      missing,
      notReported,
      state,
    };
  });

  // What needs looking at comes first
  const rank = { mixed: 0, behind: 1, same: 2, none: 3 };
  return rows.sort((a, b) => rank[a.state] - rank[b.state] || byName.compare(a.label, b.label));
}
