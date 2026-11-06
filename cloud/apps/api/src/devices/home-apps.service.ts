import { BadRequestException, Injectable } from '@nestjs/common';
import { DeviceWakeService } from '../common/device-wake.service';
import { randomUUID } from 'node:crypto';
import type { ApkPackage, User } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { deepMerge } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { TargetDto, targetWhere } from '../common/targets';
import { ApkInspector } from '../files/apk-inspector';
import { HOME_APPS_COMMAND, installCommandData, THROUGH_CONFIG_DAYS, whyCannotInstall } from './catalog';
import { ConfigSyncService } from './config-sync.service';
import { editHomeApps, generalOf, isMultiApp, ManagedApp, managedAppsOf } from './home-apps';

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

/** The name an uploaded APK goes by until a tablet has it installed and says what it is really called */
const apkLabel = (apk: ApkPackage) => apk.fileName.replace(/\.(apk|apks|xapk|apkm|zip)$/i, '');

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** What was uploaded, for each package: what can be installed, and what cannot be on its own */
interface Uploads {
  installable: Map<string, ApkPackage>;
  incomplete: Map<string, ApkPackage>;
}

@Injectable()
export class HomeAppsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configSync: ConfigSyncService,
    private readonly activity: ActivityService,
    private readonly inspector: ApkInspector,
    private readonly wake: DeviceWakeService,
  ) {}

  private async devices(target: TargetDto): Promise<TargetDevice[]> {
    const where = targetWhere(target);
    if (!where) throw new BadRequestException('Chưa chọn thiết bị');
    return this.prisma.device.findMany({ where, select: DEVICE_FIELDS });
  }

  /** For each package the newest upload that can be installed: a broken newer one does not hide it */
  private async uploads(): Promise<Uploads> {
    const rows = await this.prisma.apkPackage.findMany({
      where: { packageName: { not: null } },
      orderBy: [{ versionCode: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    const installable = new Map<string, ApkPackage>();
    const incomplete = new Map<string, ApkPackage>();
    for (const apk of rows) {
      const packageName = apk.packageName;
      if (!packageName || packageName === OWN_PACKAGE || installable.has(packageName)) continue;
      if (await this.inspector.isIncomplete(apk)) {
        if (!incomplete.has(packageName)) incomplete.set(packageName, apk);
      } else {
        installable.set(packageName, apk);
        incomplete.delete(packageName);
      }
    }
    return { installable, incomplete };
  }

  /** A readable name for every package: what a tablet said first, then what is known from elsewhere */
  private async labels(devices: TargetDevice[], uploads: Uploads): Promise<Map<string, { label: string; hasIcon: boolean; version: number }>> {
    const known = new Map<string, { label: string; hasIcon: boolean; version: number }>();
    for (const [packageName, apk] of [...uploads.incomplete, ...uploads.installable]) known.set(packageName, { label: apkLabel(apk), hasIcon: false, version: 0 });
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

  /** The installs still under way on these tablets, as "device/package" */
  private async installsUnderWay(deviceIds: string[]): Promise<Set<string>> {
    const rows = await this.prisma.command.findMany({
      where: { deviceId: { in: deviceIds }, type: 'install_apk', status: { in: ['PENDING', 'SENT'] } },
      select: { deviceId: true, params: true },
    });
    return new Set(rows.map((row) => `${row.deviceId}/${String(obj(row.params).package_name)}`));
  }

  /** What the picker shows: every app it can offer for these tablets, and where each one is now */
  async preview(target: TargetDto) {
    const devices = await this.devices(target);
    const uploads = await this.uploads();
    const labels = await this.labels(devices, uploads);
    const underWay = await this.installsUnderWay(devices.map((device) => device.id));

    const generals = devices.map((device) => generalOf(device));
    const apps = new Map<string, { onHome: number; installed: number; installing: number }>();
    const entry = (packageName: string) => {
      const found = apps.get(packageName);
      if (found) return found;
      const fresh = { onHome: 0, installed: 0, installing: 0 };
      apps.set(packageName, fresh);
      return fresh;
    };
    devices.forEach((device, index) => {
      for (const app of managedAppsOf(generals[index])) {
        if (app.showOnHomeScreen) entry(app.packageName).onHome += 1;
      }
      for (const packageName of installedOf(device) ?? []) entry(packageName).installed += 1;
    });
    for (const packageName of [...uploads.installable.keys(), ...uploads.incomplete.keys()]) entry(packageName);
    for (const key of underWay) {
      const packageName = key.slice(key.indexOf('/') + 1);
      if (apps.has(packageName)) entry(packageName).installing += 1;
    }
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
            canInstall: uploads.installable.has(packageName),
            apkIncomplete: uploads.incomplete.has(packageName),
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
    const uploads = await this.uploads();
    const labels = await this.labels(devices, uploads);
    const labelOf = (packageName: string) => labels.get(packageName)?.label ?? packageName;
    const underWay = await this.installsUnderWay(devices.map((device) => device.id));

    const now = new Date();
    const batchId = randomUUID();
    const expiresAt = new Date(now.getTime() + THROUGH_CONFIG_DAYS * 86_400_000);
    // A push is not a command for the tablet to run, but it is something the history must show
    const history: Prisma.CommandCreateManyInput[] = [];
    const record = (deviceId: string, params: Json, errorMessage?: string) => {
      history.push({
        deviceId,
        type: HOME_APPS_COMMAND,
        params: params as Prisma.InputJsonValue,
        status: errorMessage ? 'ERROR' : 'SENT',
        errorMessage,
        batchId,
        createdById: actor.id,
        createdBy: actor.email,
        sentAt: now,
        completedAt: errorMessage ? now : null,
        expiresAt,
      });
    };

    const whyNot = (packageName: string, device: TargetDevice) => {
      const apk = uploads.installable.get(packageName);
      if (apk) return `Chưa cài ${labelOf(packageName)}: ${lowerFirst(whyCannotInstall(device.capabilities, apk) ?? '')}`;
      if (uploads.incomplete.has(packageName)) return `Chưa cài ${labelOf(packageName)}: APK đã tải lên chỉ là một phần của ứng dụng, cần tải lên cả bộ tệp`;
      return `Chưa cài ${labelOf(packageName)} và chưa có APK để cài`;
    };

    let sent = 0;
    const installs: Prisma.CommandCreateManyInput[] = [];
    const skipped: Array<{ deviceId: string; name: string; reason: string }> = [];
    const accepted = new Set<string>();

    for (const device of devices) {
      const general = generalOf(device);
      const current = managedAppsOf(general);
      const installed = installedOf(device);

      const adding: string[] = [];
      const toInstall: ApkPackage[] = [];
      const refused: string[] = [];
      for (const packageName of add) {
        // A tablet that has not reported gets the app anyway, since nothing says it is missing
        if (!installed || installed.has(packageName)) adding.push(packageName);
        else if (underWay.has(`${device.id}/${packageName}`)) accepted.add(packageName);
        else if (uploads.installable.has(packageName) && !whyCannotInstall(device.capabilities, uploads.installable.get(packageName)!)) toInstall.push(uploads.installable.get(packageName)!);
        else refused.push(packageName);
      }
      if (refused.length) {
        const reason = refused.map((packageName) => whyNot(packageName, device)).join('. ');
        skipped.push({ deviceId: device.id, name: device.name, reason });
        record(device.id, { add: refused.map(labelOf) }, reason);
      }

      const next = editHomeApps(current, adding, remove, labelOf);

      // An app it lacks is installed first, and joins the screen only once that has worked
      // (showAfterInstall): a tile that opens nothing helps nobody, and an install can fail
      for (const apk of toInstall) {
        installs.push(installCommandData(device.id, apk, actor, { show_on_home: true, label: labelOf(apk.packageName!) }, batchId));
        accepted.add(apk.packageName!);
      }
      for (const packageName of adding) accepted.add(packageName);

      const changes: Json = {};
      if (JSON.stringify(next) !== JSON.stringify(current)) changes.managedApps = next;
      const switching = switchToMulti && !isMultiApp(general);
      if (switching) {
        changes.displayMode = 'external_app';
        changes.externalApp = { mode: 'multi' };
      }
      if (!Object.keys(changes).length) continue;

      const shownBefore = new Set(current.filter((app) => app.showOnHomeScreen).map((app) => app.packageName));
      const shownAfter = new Set(next.filter((app) => app.showOnHomeScreen).map((app) => app.packageName));
      await this.configSync.push([device.id], { general: changes }, undefined, {
        type: HOME_APPS_COMMAND,
        params: {
          add: [...shownAfter].filter((p) => !shownBefore.has(p)).map(labelOf),
          remove: [...shownBefore].filter((p) => !shownAfter.has(p)).map(labelOf),
          ...(switching ? { switch_to_multi: true } : {}),
        },
        actor,
        batchId,
      });
      sent += 1;
    }

    if (installs.length || history.length) await this.prisma.command.createMany({ data: [...installs, ...history] });
    this.wake.notify(installs.map((install) => install.deviceId), 'commands');

    const profileAdd = add.filter((packageName) => accepted.has(packageName));
    const hasProfileChange = profileAdd.length > 0 || remove.length > 0 || switchToMulti;
    const profile = target.groupId && hasProfileChange ? await this.saveInGroupProfile(target.groupId, devices, profileAdd, remove, switchToMulti, labelOf) : null;

    const parts = [add.length ? `thêm ${add.map(labelOf).join(', ')}` : '', remove.length ? `gỡ ${remove.map(labelOf).join(', ')}` : ''].filter(Boolean).join(', ');
    await this.activity.log({
      action: 'config.changed',
      message: `${actor.email} đã đổi ứng dụng trên màn hình của ${sent} thiết bị${parts ? `: ${parts}` : ''}`,
      user: actor,
      data: { add, remove, installs: installs.length, skipped: skipped.length, profile: profile?.updated ? profile.name : null },
    });
    return { sent, installs: installs.length, skipped, profile };
  }

  /** An install the picker asked for has worked: the app can now join the screen of that tablet */
  async showAfterInstall(deviceId: string, command: { params: unknown; batchId: string | null; createdById: string | null; createdBy: string | null }): Promise<void> {
    const params = obj(command.params);
    const packageName = params.package_name;
    if (params.show_on_home !== true || typeof packageName !== 'string') return;
    const label = typeof params.label === 'string' ? params.label : packageName;

    const device = await this.prisma.device.findUnique({ where: { id: deviceId }, select: DEVICE_FIELDS });
    if (!device) return;

    // The picker knows at once. The tablet's own list follows at its next scan, with the real name
    const reported = Array.isArray(device.installedApps) ? device.installedApps : null;
    if (reported && !installedOf(device)?.has(packageName)) {
      await this.prisma.device.update({
        where: { id: deviceId },
        data: { installedApps: [...reported, { package: packageName, label, version_code: 0 }] as Prisma.InputJsonValue },
      });
    }

    const current = managedAppsOf(generalOf(device));
    const next = editHomeApps(current, [packageName], [], () => label);
    if (JSON.stringify(next) === JSON.stringify(current)) return;
    await this.configSync.push([deviceId], { general: { managedApps: next } }, undefined, {
      type: HOME_APPS_COMMAND,
      params: { add: [label] },
      actor: { id: command.createdById, email: command.createdBy },
      batchId: command.batchId,
      source: 'after_install',
    });
  }

  /**
   * Apps removed from a tablet (uninstall_app) leave its home screen, and the list the picker shows at once:
   * the tablet's own list follows at its next scan. A group's profile is left as it is: the command was
   * for these tablets, and a profile may be used elsewhere.
   */
  async hideAfterUninstall(deviceId: string, command: { batchId: string | null; createdById: string | null; createdBy: string | null }, packages: string[]): Promise<void> {
    if (!packages.length) return;
    const device = await this.prisma.device.findUnique({ where: { id: deviceId }, select: DEVICE_FIELDS });
    if (!device) return;

    if (Array.isArray(device.installedApps)) {
      const kept = device.installedApps.filter((app) => !packages.includes(obj(app).package as string));
      if (kept.length !== device.installedApps.length) {
        await this.prisma.device.update({ where: { id: deviceId }, data: { installedApps: kept as Prisma.InputJsonValue } });
      }
    }

    const current = managedAppsOf(generalOf(device));
    const leaving = current.filter((app) => packages.includes(app.packageName));
    if (!leaving.length) return;
    const next = editHomeApps(current, [], packages, (packageName) => packageName);
    await this.configSync.push([deviceId], { general: { managedApps: next } }, undefined, {
      type: HOME_APPS_COMMAND,
      params: { remove: leaving.map((app) => app.displayName || app.packageName) },
      actor: { id: command.createdById, email: command.createdBy },
      batchId: command.batchId,
      source: 'after_uninstall',
    });
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
