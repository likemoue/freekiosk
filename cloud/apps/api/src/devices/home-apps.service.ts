import { BadRequestException, Injectable } from '@nestjs/common';
import type { ApkPackage, User } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { deepMerge } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { TargetDto, targetWhere } from '../common/targets';
import { installCommandData } from './catalog';
import { ConfigSyncService } from './config-sync.service';
import { editHomeApps, generalOf, homeCount, isMultiApp, ManagedApp, managedAppsOf } from './home-apps';

const OWN_PACKAGE = 'com.freekiosk';

const DEVICE_FIELDS = { id: true, name: true, capabilities: true, installedApps: true, reportedConfig: true, pendingConfig: true } satisfies Prisma.DeviceSelect;
type TargetDevice = Prisma.DeviceGetPayload<{ select: typeof DEVICE_FIELDS }>;

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {});

/** The packages a tablet reported, or null for a version of the app that does not report yet */
function installedOf(device: TargetDevice): Set<string> | null {
  if (!Array.isArray(device.installedApps)) return null;
  return new Set(device.installedApps.map((app) => obj(app).package).filter((p): p is string => typeof p === 'string'));
}

/** Installing with no prompt takes Device Owner. An empty list is an older app, which may have it */
const canInstall = (device: TargetDevice) => device.capabilities.length === 0 || device.capabilities.includes('silent_install');

/** The name an uploaded APK goes by until a tablet has it installed and says what it is really called */
const apkLabel = (apk: ApkPackage) => apk.fileName.replace(/\.apk$/i, '');

@Injectable()
export class HomeAppsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configSync: ConfigSyncService,
    private readonly activity: ActivityService,
  ) {}

  private async devices(target: TargetDto): Promise<TargetDevice[]> {
    const where = targetWhere(target);
    if (!where) throw new BadRequestException('Chưa chọn thiết bị');
    return this.prisma.device.findMany({ where, select: DEVICE_FIELDS });
  }

  /** For each package, the newest upload: what gets installed on a tablet that does not have it */
  private async apks(): Promise<Map<string, ApkPackage>> {
    const rows = await this.prisma.apkPackage.findMany({
      where: { packageName: { not: null } },
      orderBy: [{ versionCode: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    const newest = new Map<string, ApkPackage>();
    for (const apk of rows) {
      if (apk.packageName && apk.packageName !== OWN_PACKAGE && !newest.has(apk.packageName)) newest.set(apk.packageName, apk);
    }
    return newest;
  }

  /** A readable name for every package: what a tablet said first, then what is known from elsewhere */
  private async labels(devices: TargetDevice[], apks: Map<string, ApkPackage>): Promise<Map<string, { label: string; hasIcon: boolean; version: number }>> {
    const known = new Map<string, { label: string; hasIcon: boolean; version: number }>();
    for (const [packageName, apk] of apks) known.set(packageName, { label: apkLabel(apk), hasIcon: false, version: 0 });
    for (const device of devices) {
      for (const app of managedAppsOf(generalOf(device))) {
        if (app.displayName && !known.has(app.packageName)) known.set(app.packageName, { label: app.displayName, hasIcon: false, version: 0 });
      }
    }
    // Two queries, so that the images themselves stay in the database: the picker asks every 20 seconds
    const [rows, withIcon] = await Promise.all([
      this.prisma.appInfo.findMany({ select: { packageName: true, label: true, iconVersionCode: true } }),
      this.prisma.appInfo.findMany({ where: { icon: { not: null } }, select: { packageName: true } }),
    ]);
    const hasIcon = new Set(withIcon.map((row) => row.packageName));
    for (const row of rows) {
      known.set(row.packageName, { label: row.label, hasIcon: hasIcon.has(row.packageName), version: row.iconVersionCode });
    }
    return known;
  }

  /** What the picker shows: every app it can offer for these tablets, and where each one is now */
  async preview(target: TargetDto) {
    const devices = await this.devices(target);
    const apks = await this.apks();
    const labels = await this.labels(devices, apks);

    const generals = devices.map((device) => generalOf(device));
    const apps = new Map<string, { onHome: number; installed: number }>();
    const entry = (packageName: string) => {
      const found = apps.get(packageName);
      if (found) return found;
      const fresh = { onHome: 0, installed: 0 };
      apps.set(packageName, fresh);
      return fresh;
    };
    devices.forEach((device, index) => {
      for (const app of managedAppsOf(generals[index])) {
        if (app.showOnHomeScreen) entry(app.packageName).onHome += 1;
      }
      for (const packageName of installedOf(device) ?? []) entry(packageName).installed += 1;
    });
    for (const packageName of apks.keys()) entry(packageName);
    apps.delete(OWN_PACKAGE);

    return {
      deviceCount: devices.length,
      // A tablet that has not reported cannot say what is installed on it: the page says so
      notReporting: devices.filter((device) => installedOf(device) === null).length,
      notMultiApp: generals.filter((general) => !isMultiApp(general)).length,
      pending: devices.filter((device) => Array.isArray(obj(obj(device.pendingConfig).general).managedApps)).length,
      apps: [...apps.entries()]
        .map(([packageName, counts]) => {
          const known = labels.get(packageName);
          return {
            packageName,
            label: known?.label ?? packageName,
            iconUrl: known?.hasIcon ? `/api/admin/home-apps/icons/${packageName}?v=${known.version}` : null,
            canInstall: apks.has(packageName),
            ...counts,
          };
        })
        .sort((a, b) => a.label.localeCompare(b.label, 'vi')),
    };
  }

  async apply(target: TargetDto, add: string[], remove: string[], switchToMulti: boolean, actor: User) {
    if (add.some((packageName) => remove.includes(packageName))) throw new BadRequestException('Một ứng dụng không thể vừa thêm vừa gỡ');
    if (!add.length && !remove.length && !switchToMulti) throw new BadRequestException('Chưa chọn ứng dụng nào');

    const devices = await this.devices(target);
    const apks = await this.apks();
    const labels = await this.labels(devices, apks);
    const labelOf = (packageName: string) => labels.get(packageName)?.label ?? packageName;

    let sent = 0;
    const installs: Prisma.CommandCreateManyInput[] = [];
    const skipped: Array<{ deviceId: string; name: string; reason: string }> = [];

    for (const device of devices) {
      const general = generalOf(device);
      const current = managedAppsOf(general);
      const installed = installedOf(device);

      // Not there and nothing to install it with: a tile that opens nothing helps nobody. A tablet
      // that has not reported gets the app anyway, since nothing says it is missing.
      const missing = add.filter((packageName) => installed && !installed.has(packageName) && !current.some((app) => app.packageName === packageName));
      const toInstall = missing.filter((packageName) => apks.has(packageName) && canInstall(device));
      const refused = missing.filter((packageName) => !toInstall.includes(packageName));
      if (refused.length) {
        skipped.push({ deviceId: device.id, name: device.name, reason: `Chưa cài ${refused.map(labelOf).join(', ')}` });
      }

      const adding = add.filter((packageName) => !refused.includes(packageName));
      const next = editHomeApps(current, adding, remove, labelOf);
      // With nothing left, the tablet would fall back to the single app screen, or to nothing at all
      if (homeCount(next) === 0 && homeCount(current) > 0) {
        skipped.push({ deviceId: device.id, name: device.name, reason: 'Phải còn ít nhất một ứng dụng trên màn hình' });
        continue;
      }

      const changes: Json = {};
      if (JSON.stringify(next) !== JSON.stringify(current)) changes.managedApps = next;
      if (switchToMulti && !isMultiApp(general)) {
        changes.displayMode = 'external_app';
        changes.externalApp = { mode: 'multi' };
      }
      for (const packageName of toInstall) installs.push(installCommandData(device.id, apks.get(packageName)!, actor));
      if (!Object.keys(changes).length) continue;
      await this.configSync.push([device.id], { general: changes });
      sent += 1;
    }

    if (installs.length) await this.prisma.command.createMany({ data: installs });
    const profile = target.groupId ? await this.saveInGroupProfile(target.groupId, devices, add, remove, switchToMulti, labelOf) : null;

    const parts = [add.length ? `thêm ${add.map(labelOf).join(', ')}` : '', remove.length ? `gỡ ${remove.map(labelOf).join(', ')}` : ''].filter(Boolean).join(', ');
    await this.activity.log({
      action: 'config.changed',
      message: `${actor.email} đã đổi ứng dụng trên màn hình của ${sent} thiết bị${parts ? `: ${parts}` : ''}`,
      user: actor,
      data: { add, remove, installs: installs.length, skipped: skipped.length, profile: profile?.updated ? profile.name : null },
    });
    return { sent, installs: installs.length, skipped, profile };
  }

  /**
   * A profile is what a tablet joining the group receives, and what saving the profile sends again.
   * Left behind, it would hand new tablets the old apps and one day undo this change. A profile
   * also used elsewhere stays as it is: a command for one group must not reach the others.
   */
  private async saveInGroupProfile(groupId: string, devices: TargetDevice[], add: string[], remove: string[], switchToMulti: boolean, labelOf: (packageName: string) => string) {
    const group = await this.prisma.group.findUnique({ where: { id: groupId }, include: { profile: true } });
    const profile = group?.profile;
    if (!profile) return null;

    const [otherGroups, otherDevices] = await Promise.all([
      this.prisma.group.count({ where: { profileId: profile.id, id: { not: groupId } } }),
      this.prisma.device.count({ where: { profileId: profile.id, unenrolledAt: null, OR: [{ groupId: { not: groupId } }, { groupId: null }] } }),
    ]);
    if (otherGroups + otherDevices > 0) return { name: profile.name, updated: false };

    const general = obj(obj(profile.config).general);
    // A profile with no list yet starts from what the tablets of the group have now
    let base = managedAppsOf(general);
    if (!Array.isArray(general.managedApps)) {
      const seen = new Map<string, ManagedApp>();
      for (const device of devices) {
        for (const app of managedAppsOf(generalOf(device))) if (!seen.has(app.packageName)) seen.set(app.packageName, app);
      }
      base = [...seen.values()];
    }

    const changes: Json = { managedApps: editHomeApps(base, add, remove, labelOf) };
    // A list alone shows nothing on a tablet that opens one app: new tablets must come up like the
    // ones already in the group. A mode the profile states itself stays, unless asked otherwise.
    const someMulti = devices.some((device) => isMultiApp(generalOf(device)));
    if (switchToMulti || (someMulti && general.displayMode === undefined)) changes.displayMode = 'external_app';
    if (switchToMulti || (someMulti && obj(general.externalApp).mode === undefined)) changes.externalApp = { mode: 'multi' };

    await this.prisma.configProfile.update({
      where: { id: profile.id },
      data: { config: deepMerge(profile.config, { general: changes }) as Prisma.InputJsonValue },
    });
    return { name: profile.name, updated: true };
  }

  async icon(packageName: string): Promise<Buffer | null> {
    const row = await this.prisma.appInfo.findUnique({ where: { packageName }, select: { icon: true } });
    return row?.icon ? Buffer.from(row.icon) : null;
  }
}
