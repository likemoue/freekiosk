import { BadRequestException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import type { Device, EnrollmentToken } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { CryptoService, normalizeCode, randomToken, sha256 } from '../common/crypto.service';
import { DeviceWakeService, WAKE_HOLD_MS } from '../common/device-wake.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { StorageService } from '../common/storage.service';
import { env } from '../config/env';
import { AlertsService } from '../alerts/alerts.service';
import { SensitiveValues } from '../devices/config-sync.service';
import { COMMAND_LABELS, THROUGH_CONFIG_TYPES } from '../devices/catalog';
import { PACKAGE_NAME } from '../devices/home-apps';
import { HomeAppsService } from '../devices/home-apps.service';
import { SignageService } from '../signage/signage.service';
import { LOCATION_STATE_TEXT, locationColumns } from './location';

const SCREENSHOTS_KEPT_PER_DEVICE = 30;
const OWN_PACKAGE = 'com.freekiosk';
const ICONS_PER_ROUND = 8;
const MAX_REPORTED_APPS = 1000;
const MAX_ICON_BYTES = 256 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Json = Record<string, unknown>;

const obj = (value: unknown): Json => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {});
const str = (value: unknown, max = 500): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined;
const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const int = (value: unknown): number | undefined => {
  const n = num(value);
  return n === undefined ? undefined : Math.round(n);
};
const strings = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 100) : undefined;

interface ReportedApp {
  package: string;
  label: string;
  version_code: number;
  version_name?: string;
}

/** The list as an app sent it, or as it was stored: what does not read as an app is dropped */
function reportedApps(value: unknown): ReportedApp[] {
  if (!Array.isArray(value)) return [];
  const apps: ReportedApp[] = [];
  for (const item of value.slice(0, MAX_REPORTED_APPS)) {
    const packageName = str(obj(item).package, 255);
    if (!packageName || !PACKAGE_NAME.test(packageName)) continue;
    apps.push({
      package: packageName,
      label: str(obj(item).label, 120) ?? packageName,
      ...(str(obj(item).version_name, 64) ? { version_name: str(obj(item).version_name, 64) } : {}),
      // The column is 32-bit. Very few apps go past it, and they only lose the icon refresh
      version_code: Math.min(Math.max(int(obj(item).version_code) ?? 0, 0), 2_147_483_647),
    });
  }
  return apps;
}

/** A served image must really be one: this comes from a device, and goes to an admin's browser */
function pngFrom(value: unknown): Buffer | null {
  if (typeof value !== 'string' || value.length > (MAX_ICON_BYTES * 4) / 3 + 4) return null;
  const bytes = Buffer.from(value, 'base64');
  return bytes.length > PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ? bytes : null;
}

/** The device contract of the app: src/utils/CloudSyncService.ts and CloudCommandService.ts */
/** What the app says of a command it started and can no longer follow (CloudCommandService) */
const INTERRUPTED_MESSAGE = 'Device restarted before the command result could be reported';

@Injectable()
export class DeviceApiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wake: DeviceWakeService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly activity: ActivityService,
    private readonly alerts: AlertsService,
    private readonly homeApps: HomeAppsService,
    private readonly signage: SignageService,
  ) {}

  // ─── Enrollment ───────────────────────────────────────────────────────────

  private async deviceName(info: Json): Promise<string> {
    const base = [str(info.manufacturer, 60), str(info.model, 60)].filter(Boolean).join(' ') || 'Thiết bị mới';
    const same = await this.prisma.device.count({ where: { name: { startsWith: base } } });
    return same === 0 ? base : `${base} #${same + 1}`;
  }

  private refusal(token: EnrollmentToken | null): string | null {
    if (!token) return 'Mã đăng ký không hợp lệ';
    if (token.revokedAt) return 'Mã đăng ký đã bị thu hồi';
    if (token.expiresAt < new Date()) return 'Mã đăng ký đã hết hạn';
    if (token.usedCount >= token.maxUses) return 'Mã đăng ký đã được sử dụng';
    return null;
  }

  async enroll(body: Json, ip: string | null) {
    const token = str(body.token, 300);
    if (!token) throw new BadRequestException({ error: 'Thiếu mã đăng ký' });

    const row = await this.prisma.enrollmentToken.findUnique({
      where: { tokenHash: sha256(normalizeCode(token)) },
      include: { group: true, profile: true },
    });
    const refusal = this.refusal(row);
    if (refusal || !row) throw new BadRequestException({ error: refusal });

    // Claimed in one statement: two tablets using the same token at once cannot both get in
    const claim = await this.prisma.enrollmentToken.updateMany({
      where: { id: row.id, usedCount: { lt: row.maxUses }, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { usedCount: { increment: 1 }, lastUsedAt: new Date() },
    });
    if (claim.count === 0) throw new BadRequestException({ error: 'Mã đăng ký đã được sử dụng' });

    const info = obj(body.device_info);
    const apiKey = `fkd_${randomToken()}`;
    const profile =
      row.profile ??
      (row.group?.profileId ? await this.prisma.configProfile.findUnique({ where: { id: row.group.profileId } }) : null);

    const device = await this.prisma.device.create({
      data: {
        name: await this.deviceName(info),
        apiKeyHash: sha256(apiKey),
        groupId: row.groupId,
        profileId: row.profileId,
        enrollmentTokenId: row.id,
        model: str(info.model, 120),
        manufacturer: str(info.manufacturer, 120),
        androidVersion: str(info.android_version, 40),
        appVersion: str(info.app_version, 40),
        serialNumber: str(info.serial_number, 120),
        formFactor: str(info.form_factor, 20) ?? 'tablet',
        capabilities: strings(info.capabilities) ?? [],
        publicIp: ip,
        // A fresh install is at version 0: anything above it is delivered at the first heartbeat
        ...(profile
          ? { configVersion: 1, pendingConfig: profile.config as Prisma.InputJsonValue, pendingSensitiveEnc: profile.sensitiveEnc }
          : {}),
      },
    });

    await this.activity.log({ action: 'device.enrolled', message: `Thiết bị mới đã đăng ký: ${device.name}`, device, ip });
    const organization = await this.settings.organization();
    return { device_id: device.id, api_key: apiKey, organization_name: organization.name };
  }

  /** The key stops working and what was queued is dropped; the row stays for its history */
  private async detach(device: Device): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.device.update({
        where: { id: device.id },
        data: {
          unenrolledAt: now,
          online: false,
          forceUnenroll: false,
          apiKeyHash: `revoked:${device.id}`,
          pendingConfig: Prisma.DbNull,
          pendingSensitiveEnc: null,
          reportedSensitiveEnc: null,
        },
      }),
      this.prisma.command.updateMany({
        where: { deviceId: device.id, status: { in: ['PENDING', 'SENT'] } },
        data: { status: 'CANCELLED', secretEnc: null, completedAt: now },
      }),
      this.prisma.alert.updateMany({ where: { deviceId: device.id, resolvedAt: null }, data: { resolvedAt: now } }),
    ]);
    this.signage.forget(device.id);
  }

  async unenroll(device: Device, ip: string | null): Promise<void> {
    await this.detach(device);
    await this.activity.log({ action: 'device.unenrolled', message: `${device.name} đã tự hủy đăng ký từ thiết bị`, device, ip });
  }

  // ─── Heartbeat ────────────────────────────────────────────────────────────

  private telemetry(body: Json): Prisma.DeviceUpdateInput {
    const battery = obj(body.battery);
    const network = obj(body.network);
    const display = obj(body.display);
    const app = obj(body.app);
    const system = obj(body.system);
    // Telemetry is best-effort on the device: a heartbeat may come without any of it
    if (!Object.keys(system).length && !Object.keys(network).length && !Object.keys(display).length) return {};
    return {
      // No battery key is a TV or a box: the level is unknown, not zero
      batteryLevel: int(battery.level) ?? null,
      batteryCharging: bool(battery.charging) ?? null,
      wifiSsid: str(network.wifi_ssid, 120) ?? null,
      wifiSignalDbm: int(network.wifi_signal_dbm) ?? null,
      ethernet: bool(network.ethernet_connected) ?? null,
      ipAddress: str(network.ip_address, 60) ?? null,
      screenOn: bool(display.screen_on) ?? null,
      brightness: num(display.brightness) ?? null,
      currentUrl: str(app.current_url, 2000) ?? null,
      kioskMode: bool(app.kiosk_mode) ?? null,
      deviceOwner: bool(app.device_owner) ?? null,
      ...(strings(app.capabilities)?.length ? { capabilities: strings(app.capabilities) } : {}),
      appVersion: str(system.app_version, 40),
      model: str(system.model, 120),
      manufacturer: str(system.manufacturer, 120),
      androidVersion: str(system.android_version, 40),
      formFactor: str(system.form_factor, 20),
      freeStorageMb: int(system.free_storage_mb) ?? null,
      freeMemoryMb: int(system.free_memory_mb) ?? null,
      uptimeSeconds: int(system.uptime_seconds) ?? null,
      timezone: str(system.timezone, 64) ?? null,
      utcOffsetMinutes: int(system.utc_offset_minutes) ?? null,
      // Absent until the app has heard of playlists: stays null, which the dashboard shows as such
      signagePlaylistVersion: str(system.signage_playlist_version, 64) ?? (system.signage_playlist_version === '' ? '' : undefined),
      telemetry: { battery, network, display, app, system } as Prisma.InputJsonValue,
    };
  }

  private reportedConfig(device: Device, body: Json, version: number): Prisma.DeviceUpdateInput {
    const data: Prisma.DeviceUpdateInput = {};
    const config = obj(body.config);
    if (Object.keys(config).length) {
      const updatedAt = str(body.config_updated_at, 40);
      const at = updatedAt ? new Date(updatedAt) : null;
      const validAt = at && !Number.isNaN(at.getTime()) ? at : null;
      const changed =
        !device.reportedConfig ||
        device.reportedConfigVersion !== version ||
        (validAt ? device.reportedConfigAt?.getTime() !== validAt.getTime() : false);
      if (changed) {
        data.reportedConfig = config as Prisma.InputJsonValue;
        data.reportedConfigAt = validAt ?? new Date();
        data.reportedConfigVersion = version;
      }
    }
    // The tablet never sends its PIN; the other secrets are kept encrypted as a backup
    const sensitive = obj(body.sensitive_config);
    if (Object.keys(sensitive).length) {
      const kept: SensitiveValues = {};
      if (typeof sensitive.mqttPassword === 'string') kept.mqttPassword = sensitive.mqttPassword;
      if (typeof sensitive.restApiKey === 'string') kept.restApiKey = sensitive.restApiKey;
      if (typeof sensitive.httpBasicAuthPassword === 'string') kept.httpBasicAuthPassword = sensitive.httpBasicAuthPassword;
      const before = this.crypto.decryptJson<SensitiveValues>(device.reportedSensitiveEnc);
      if (JSON.stringify(before ?? {}) !== JSON.stringify(kept)) data.reportedSensitiveEnc = this.crypto.encryptJson(kept);
    }
    return data;
  }

  async heartbeat(device: Device, body: Json, ip: string | null) {
    const now = new Date();
    const deviceVersion = int(body.config_version) ?? 0;
    const appsHash = str(body.installed_apps_hash, 64);
    // Asked of every tablet unless switched off on the map page; a place sent once it is, is not kept
    const { enabled: wantsLocation } = await this.settings.location();

    const data: Prisma.DeviceUpdateInput = {
      lastSeenAt: now,
      online: true,
      publicIp: ip,
      ...this.telemetry(body),
      ...this.reportedConfig(device, body, deviceVersion),
      ...(wantsLocation && body.location !== undefined ? locationColumns(device, obj(body.location), now) : {}),
    };

    const hasPending = device.pendingConfig !== null || device.pendingSensitiveEnc !== null;
    const needsApply = hasPending && deviceVersion < device.configVersion;
    // A database restored from an older backup: never fall behind what the device has seen
    if (deviceVersion > device.configVersion) data.configVersion = deviceVersion;

    const updated = await this.prisma.device.update({ where: { id: device.id }, data });

    if (hasPending && !needsApply) {
      // The device reached this version: what was pending is now in its own report. The condition
      // is checked in the statement, or a change saved in the dashboard this very moment, after
      // this device row was read, would be cleared without ever being delivered.
      const { count } = await this.prisma.device.updateMany({
        where: { id: device.id, configVersion: { lte: deviceVersion } },
        data: { pendingConfig: Prisma.DbNull, pendingSensitiveEnc: null, configSyncedAt: now },
      });
      // What the history said was on its way has arrived, even after a week away
      if (count) {
        await this.prisma.command.updateMany({
          where: { deviceId: device.id, type: { in: THROUGH_CONFIG_TYPES }, status: { in: ['SENT', 'EXPIRED'] }, createdAt: { lte: now } },
          data: { status: 'SUCCESS', completedAt: now },
        });
      }
    }

    if (!device.online) {
      await this.activity.log({ action: 'device.online', message: `${device.name} đã trực tuyến`, device, ip });
    }
    if (hasPending && !needsApply) {
      await this.activity.log({ action: 'config.applied', message: `${device.name} đã áp dụng cấu hình mới`, device });
    }
    void this.alerts.onHeartbeat(updated);

    const pendingCommands = await this.prisma.command.count({
      where: { deviceId: device.id, status: 'PENDING', expiresAt: { gt: now } },
    });

    if (device.forceUnenroll) {
      await this.detach(device);
      await this.activity.log({ action: 'device.unenrolled', severity: 'warning', message: `${device.name} đã được hủy đăng ký từ trang quản lý`, device });
    }

    return {
      status: 'ok',
      pending_commands: pendingCommands,
      server_time: now.toISOString(),
      sync_action: needsApply ? 'apply' : 'none',
      config: needsApply ? (device.pendingConfig ?? {}) : null,
      sensitive_config: needsApply ? this.crypto.decryptJson(device.pendingSensitiveEnc) : null,
      config_version: Math.max(device.configVersion, deviceVersion),
      force_unenroll: device.forceUnenroll,
      playlist_version: await this.signage.versionFor(device.id),
      device_name: device.name,
      // The app only sends the list when asked, and an icon only once per version across the fleet
      installed_apps_wanted: !!appsHash && appsHash !== device.installedAppsHash,
      app_icons_wanted: device.appIconsWanted ? await this.nextIcons(device.id, reportedApps(device.installedApps)) : [],
      location_wanted: wantsLocation,
    };
  }

  // ─── Commands ─────────────────────────────────────────────────────────────

  /** The tablet waits here: see DeviceWakeService */
  async waitForWork(device: Device, hold: string | undefined, onClose: (cancel: () => void) => void) {
    const seconds = Number(hold);
    const holdMs = seconds > 0 ? Math.min(seconds * 1000, WAKE_HOLD_MS) : WAKE_HOLD_MS;
    const pending = await this.prisma.command.count({ where: { deviceId: device.id, status: 'PENDING', expiresAt: { gt: new Date() } } });
    const { answer, cancel } = this.wake.wait(device.id, pending > 0, holdMs);
    onClose(cancel);
    return answer;
  }

  /** Hands over what is pending, and moves it to "sent" so it is never handed over twice */
  async takeCommands(device: Device) {
    const now = new Date();
    const commands = await this.prisma.command.findMany({
      where: { deviceId: device.id, status: 'PENDING', type: { not: 'install_apk' }, expiresAt: { gt: now } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    if (commands.length) {
      await this.prisma.command.updateMany({
        where: { id: { in: commands.map((c) => c.id) }, status: 'PENDING' },
        data: { status: 'SENT', sentAt: now, secretEnc: null },
      });
    }
    return {
      commands: commands.map((c) => ({
        id: c.id,
        type: c.type,
        params: { ...(c.params as Json), ...this.crypto.decryptJson(c.secretEnc) },
        created_at: c.createdAt.toISOString(),
        expires_at: c.expiresAt.toISOString(),
      })),
    };
  }

  async takeUpdates(device: Device) {
    const now = new Date();
    const commands = await this.prisma.command.findMany({
      where: { deviceId: device.id, status: 'PENDING', type: 'install_apk', expiresAt: { gt: now } },
      orderBy: { createdAt: 'asc' },
      take: 5,
    });
    const updates: Array<{ command_id: string; package_name: string | null; version_name: string | null; download_url: string }> = [];
    for (const command of commands) {
      const apkId = (command.params as Json).apk_id;
      const apk = typeof apkId === 'string' ? await this.prisma.apkPackage.findUnique({ where: { id: apkId } }) : null;
      if (!apk) {
        await this.prisma.command.update({
          where: { id: command.id },
          data: { status: 'ERROR', errorMessage: 'Tệp APK đã bị xóa', completedAt: now },
        });
        continue;
      }
      await this.prisma.command.update({ where: { id: command.id }, data: { status: 'SENT', sentAt: now } });
      updates.push({
        command_id: command.id,
        package_name: apk.packageName,
        version_name: apk.versionName,
        download_url: `${env().publicUrl}/api/v1/devices/${device.id}/apk/${apk.id}/`,
      });
    }
    return updates;
  }

  async recordResult(device: Device, commandId: string, body: Json): Promise<void> {
    const command = await this.prisma.command.findFirst({ where: { id: commandId, deviceId: device.id } });
    if (!command) throw new NotFoundException({ error: 'Không tìm thấy lệnh' });
    let ok = body.status === 'success';
    let errorMessage = str(body.error_message, 2000);
    // The tablet says what it found, also when it found nothing: the reason is put in words here
    if (command.type === 'locate' && ok) {
      const report = obj(obj(body.result).location);
      if (report.state !== 'ok') {
        ok = false;
        errorMessage = LOCATION_STATE_TEXT[String(report.state)] ?? 'Máy không trả lời vị trí';
      }
      const columns = locationColumns(device, report);
      if (Object.keys(columns).length && (await this.settings.location()).enabled) {
        await this.prisma.device.update({ where: { id: device.id }, data: columns });
      }
    }
    // Up to 2.1.0-beta.9 a tablet could call a command interrupted while it was still running, on coming
    // back from Settings, and then say how it really ended. That is the one answer worth changing
    const onlyInterrupted = ok && command.status === 'ERROR' && command.errorMessage === INTERRUPTED_MESSAGE;
    // A result that arrives after the expiry is still the truth about what happened
    if ((command.status === 'SUCCESS' || command.status === 'ERROR') && !onlyInterrupted) return;
    await this.prisma.command.update({
      where: { id: command.id },
      data: {
        status: ok ? 'SUCCESS' : 'ERROR',
        result: body.result === null || body.result === undefined ? Prisma.DbNull : (obj(body.result) as Prisma.InputJsonValue),
        errorMessage: ok ? null : (errorMessage ?? 'Lỗi không xác định'),
        completedAt: new Date(),
      },
    });
    if (!ok) {
      await this.activity.log({
        action: 'command.failed',
        severity: 'warning',
        message: `${device.name}: lệnh "${COMMAND_LABELS[command.type] ?? command.type}" thất bại: ${errorMessage ?? 'không rõ lý do'}`,
        device,
      });
    }
    if (ok && command.type === 'install_apk') await this.homeApps.showAfterInstall(device.id, command);
    // What went is off the home screen, also when another app of the same command could not go
    if (command.type === 'uninstall_app') {
      await this.homeApps.hideAfterUninstall(device.id, command, strings(obj(body.result).removed) ?? []);
    }
  }

  // ─── Screenshots ──────────────────────────────────────────────────────────

  async saveScreenshot(device: Device, file: Express.Multer.File | undefined, capturedAtRaw: unknown): Promise<void> {
    if (!file) throw new BadRequestException({ error: 'Thiếu tệp ảnh' });
    const capturedAt = new Date(typeof capturedAtRaw === 'string' ? capturedAtRaw : Date.now());
    const storageKey = await this.storage.adopt(file.path, 'screenshots', '.png');
    await this.prisma.screenshot.create({
      data: {
        deviceId: device.id,
        storageKey,
        sizeBytes: file.size,
        capturedAt: Number.isNaN(capturedAt.getTime()) ? new Date() : capturedAt,
      },
    });
    const old = await this.prisma.screenshot.findMany({
      where: { deviceId: device.id },
      orderBy: { createdAt: 'desc' },
      skip: SCREENSHOTS_KEPT_PER_DEVICE,
    });
    if (old.length) {
      await this.prisma.screenshot.deleteMany({ where: { id: { in: old.map((s) => s.id) } } });
      await Promise.all(old.map((s) => this.storage.remove(s.storageKey)));
    }
  }

  /**
   * The newest FreeKiosk uploaded here. Unlike install_apk nobody chose this file for this tablet,
   * so the app compares version codes and asks before installing. Of two builds of one version
   * the one that is not -cloudprovi wins: that build has its accessibility service stripped, and
   * a tablet installed over USB would lose it.
   */
  async latestAppUpdate(device: Device) {
    const newest = await this.prisma.apkPackage.findFirst({
      where: { packageName: OWN_PACKAGE, versionCode: { not: null } },
      orderBy: { versionCode: 'desc' },
      select: { versionCode: true },
    });
    if (!newest) return { update: null };

    const builds = await this.prisma.apkPackage.findMany({
      where: { packageName: OWN_PACKAGE, versionCode: newest.versionCode },
      orderBy: { createdAt: 'desc' },
    });
    const apk = builds.find((build) => !/cloudprovi/i.test(build.fileName)) ?? builds[0];
    return {
      update: {
        version: apk.versionName,
        version_code: apk.versionCode,
        notes: apk.notes,
        published_at: apk.createdAt.toISOString(),
        download_url: `${env().publicUrl}/api/v1/devices/${device.id}/apk/${apk.id}/`,
      },
    };
  }

  // ─── Installed apps ───────────────────────────────────────────────────────

  /** The apps this tablet can open. Answers with the first icons the website still lacks */
  async reportApps(device: Device, body: Json) {
    const hash = str(body.hash, 64);
    if (!hash || !Array.isArray(body.apps)) throw new BadRequestException({ error: 'Thiếu danh sách ứng dụng' });
    const apps = reportedApps(body.apps);

    const known = await this.prisma.appInfo.findMany({ where: { packageName: { in: apps.map((app) => app.package) } }, select: { packageName: true, label: true } });
    const labels = new Map(known.map((row) => [row.packageName, row.label]));
    await this.prisma.appInfo.createMany({
      data: apps.filter((app) => !labels.has(app.package)).map((app) => ({ packageName: app.package, label: app.label })),
      skipDuplicates: true,
    });
    for (const app of apps) {
      const label = labels.get(app.package);
      if (label !== undefined && label !== app.label) {
        await this.prisma.appInfo.update({ where: { packageName: app.package }, data: { label: app.label } });
      }
    }

    await this.prisma.device.update({
      where: { id: device.id },
      data: { installedApps: apps as unknown as Prisma.InputJsonValue, installedAppsHash: hash, appIconsWanted: true },
    });
    return { icons_wanted: await this.nextIcons(device.id, apps) };
  }

  /** Icons for the packages it reported. One it could not read is noted, so nobody asks for it again */
  async saveIcons(device: Device, body: Json) {
    const apps = reportedApps(device.installedApps);
    const versions = new Map(apps.map((app) => [app.package, app.version_code]));
    for (const item of Array.isArray(body.icons) ? body.icons.slice(0, ICONS_PER_ROUND * 2) : []) {
      const packageName = str(obj(item).package, 255);
      const version = packageName === undefined ? undefined : versions.get(packageName);
      if (packageName === undefined || version === undefined) continue;
      const png = pngFrom(obj(item).png_base64);
      await this.prisma.appInfo.updateMany({
        where: { packageName, iconVersionCode: { lte: version } },
        data: { iconVersionCode: version, ...(png ? { icon: new Uint8Array(png) } : {}) },
      });
    }
    return { icons_wanted: await this.nextIcons(device.id, apps) };
  }

  /** Which icons to ask this tablet for next. The flag stops the asking once there are none */
  private async nextIcons(deviceId: string, apps: ReportedApp[]): Promise<string[]> {
    const rows = await this.prisma.appInfo.findMany({
      where: { packageName: { in: apps.map((app) => app.package) } },
      select: { packageName: true, iconVersionCode: true },
    });
    const held = new Map(rows.map((row) => [row.packageName, row.iconVersionCode]));
    const wanted = apps.filter((app) => (held.get(app.package) ?? -1) < app.version_code);
    if (!wanted.length) await this.prisma.device.update({ where: { id: deviceId }, data: { appIconsWanted: false } });
    return wanted.slice(0, ICONS_PER_ROUND).map((app) => app.package);
  }

  async apkFile(apkId: string): Promise<{ path: string; fileName: string }> {
    const apk = await this.prisma.apkPackage.findUnique({ where: { id: apkId } });
    if (!apk) throw new GoneException({ error: 'Tệp APK đã bị xóa' });
    return { path: this.storage.path(apk.storageKey), fileName: apk.fileName };
  }
}
