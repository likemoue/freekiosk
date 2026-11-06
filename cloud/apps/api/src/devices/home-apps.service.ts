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

/** The source of what the website starts by itself (installMissing): the history says Tự động */
export const AUTO_INSTALL_SOURCE = 'home_missing';

/** What the app says of a command a restart of FreeKiosk cut short (CloudCommandService) */
const INTERRUPTED = 'Device restarted before the command result could be reported';
/** An install cut short goes again, this many times in all */
const MAX_CUT_SHORT = 3;

/** What was uploaded, for each package: what can be installed, and what cannot be on its own */
interface Uploads {
  installable: Map<string, ApkPackage>;
  incomplete: Map<string, ApkPackage>;
}

@Injectable()
export class HomeAppsService {
  /** What installMissing last looked at for each tablet */
  private readonly lookedAt = new Map<string, string>();

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

  /**
   * For each package the newest upload that can be installed: a broken newer one does not hide it. Two
   * files of the same version (iclass.apk and iclass-staging.apk) go by the one tablets were given
   * before, then by the newer upload: the order the files went up in says nothing about which is meant.
   */
  private async uploads(): Promise<Uploads> {
    const found = await this.prisma.apkPackage.findMany({ where: { packageName: { not: null } } });
    // The history is read only for files that tie: the picker asks every 20 seconds
    const versionOf = (apk: ApkPackage) => `${apk.packageName}/${apk.versionCode}`;
    const files = new Map<string, number>();
    for (const apk of found) files.set(versionOf(apk), (files.get(versionOf(apk)) ?? 0) + 1);
    const tied = found.filter((apk) => (files.get(versionOf(apk)) ?? 0) > 1).map((apk) => apk.id);
    const given = tied.length
      ? await this.prisma.$queryRaw<Array<{ apk_id: string; installs: number }>>`
          SELECT params->>'apk_id' AS apk_id, count(*)::int AS installs FROM "Command"
          WHERE type = 'install_apk' AND status = 'SUCCESS' AND params->>'apk_id' = ANY(${tied}::text[]) GROUP BY 1`
      : [];
    const installs = new Map(given.map((row) => [row.apk_id, row.installs]));
    const rows = found.sort(
      (a, b) =>
        (b.versionCode ?? -1) - (a.versionCode ?? -1) ||
        (installs.get(b.id) ?? 0) - (installs.get(a.id) ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    );
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
      // The hash goes with it: kept, it would match the tablet's again once the app is back, and the
      // website would never ask for the list that has it
      if (kept.length !== device.installedApps.length) {
        await this.prisma.device.update({ where: { id: deviceId }, data: { installedApps: kept as Prisma.InputJsonValue, installedAppsHash: null } });
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
   * A tablet whose home screen lists an app it lacks gets the app from the library, once. That is how a
   * tablet enrolled with a profile comes up with the profile's apps, since a profile only says what goes
   * on the screen, and how an app added to a profile reaches the tablets missing it. The grid hides a tile
   * whose app is missing and looks again only when its list changes, so the tile leaves the list for the
   * length of the install and comes back with showAfterInstall. An install that failed is not tried
   * again by itself: the history shows it, and the picker can send it again. Looked at when the list of
   * apps arrives, and at each heartbeat once it is current, at no cost unless something is missing.
   */
  async installMissing(device: TargetDevice & { installedAppsHash: string | null; configVersion: number }): Promise<void> {
    const installed = installedOf(device);
    if (!installed) return;
    const general = generalOf(device);
    const missing = managedAppsOf(general).filter((app) => app.packageName !== OWN_PACKAGE && !installed.has(app.packageName));
    if (!missing.length) return;
    // Once for each state of the tablet and of the library: a heartbeat every 30 seconds must not go
    // through the library each time, and an APK uploaded later must still reach the tablets lacking it
    const library = await this.prisma.apkPackage.aggregate({ _count: { _all: true }, _max: { createdAt: true } });
    const state = `${device.configVersion}/${device.installedAppsHash}/${library._count._all}/${library._max.createdAt?.getTime() ?? 0}`;
    if (this.lookedAt.get(device.id) === state) return;
    this.lookedAt.set(device.id, state);
    try {
      await this.installFor(device, general, missing);
    } catch (error) {
      this.lookedAt.delete(device.id);
      throw error;
    }
  }

  /** Looks again at the next heartbeat, whatever it has looked at: an install of its was cut short */
  forget(deviceId: string): void {
    this.lookedAt.delete(deviceId);
  }

  private async installFor(device: TargetDevice, general: Json, missing: ManagedApp[]): Promise<void> {
    // Under way, whoever sent it, or tried before by this code: what failed waits for someone to look.
    // Except an install a restart of FreeKiosk cut short, which the USB tool does while it sets a new
    // tablet up (seen on a TB330XU enrolled with the iCLASS profile): that one goes again
    const earlier = await this.prisma.command.findMany({
      where: { deviceId: device.id, type: 'install_apk', OR: [{ source: AUTO_INSTALL_SOURCE }, { status: { in: ['PENDING', 'SENT'] } }] },
      select: { params: true, status: true, errorMessage: true },
    });
    const tried = new Set<unknown>();
    const cutShort = new Map<unknown, number>();
    // An app taken off the screen for an install that never finished stays hidden: it comes back with the next
    const shownBefore = new Set<unknown>();
    for (const row of earlier) {
      const params = obj(row.params);
      if (params.show_on_home === true) shownBefore.add(params.package_name);
      if (row.status === 'ERROR' && row.errorMessage === INTERRUPTED) cutShort.set(params.package_name, (cutShort.get(params.package_name) ?? 0) + 1);
      else tried.add(params.package_name);
    }
    for (const [packageName, times] of cutShort) if (times >= MAX_CUT_SHORT) tried.add(packageName);
    const wanted = missing.filter((app) => !tried.has(app.packageName));
    if (!wanted.length) return;

    const uploads = await this.uploads();
    const now = new Date();
    const batchId = randomUUID();
    const nobody = { id: null, email: null };
    const lines: Prisma.CommandCreateManyInput[] = [];
    const waiting: ManagedApp[] = [];
    for (const app of wanted) {
      const apk = uploads.installable.get(app.packageName);
      // Nothing to install it from: the grid keeps the tile hidden, as before
      if (!apk) continue;
      const label = app.displayName || apkLabel(apk);
      const show = app.showOnHomeScreen || shownBefore.has(app.packageName);
      const line: Prisma.CommandCreateManyInput = {
        ...installCommandData(device.id, apk, nobody, show ? { show_on_home: true, label } : { label }, batchId),
        source: AUTO_INSTALL_SOURCE,
      };
      const reason = whyCannotInstall(device.capabilities, apk);
      if (reason) {
        // Said once in the history, where the next look finds it and leaves it
        lines.push({ ...line, status: 'ERROR', errorMessage: reason, completedAt: now });
        continue;
      }
      lines.push(line);
      if (app.showOnHomeScreen) waiting.push(app);
    }
    if (!lines.length) return;

    if (waiting.length) {
      const names = new Set(waiting.map((app) => app.packageName));
      const managedApps = managedAppsOf(general).map((app) => (names.has(app.packageName) ? { ...app, showOnHomeScreen: false } : app));
      await this.configSync.push([device.id], { general: { managedApps } }, undefined, {
        type: HOME_APPS_COMMAND,
        params: { wait_install: waiting.map((app) => app.displayName || app.packageName) },
        actor: nobody,
        batchId,
        source: AUTO_INSTALL_SOURCE,
      });
    }
    await this.prisma.command.createMany({ data: lines });
    this.wake.notify([device.id], 'commands');

    const labels = (rows: Prisma.CommandCreateManyInput[]) => rows.map((row) => String(obj(row.params).label)).join(', ');
    const queued = lines.filter((line) => line.status !== 'ERROR');
    const refused = lines.filter((line) => line.status === 'ERROR');
    await this.activity.log({
      action: 'apk.auto_install',
      severity: refused.length ? 'warning' : 'info',
      message: [
        queued.length ? `Tự cài ${labels(queued)} lên ${device.name}: có trong danh sách màn hình chính của máy nhưng máy chưa cài` : '',
        refused.length ? `Không tự cài được ${labels(refused)} lên ${device.name}: ${refused.map((row) => row.errorMessage).join('. ')}` : '',
      ].filter(Boolean).join('. '),
      device,
      data: { batchId, packages: lines.map((row) => String(obj(row.params).package_name)) },
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
