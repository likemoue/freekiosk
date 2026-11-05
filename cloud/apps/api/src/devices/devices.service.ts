import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Device, Prisma, User } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { SignageService } from '../signage/signage.service';
import { ConfigSyncService, SensitiveValues } from './config-sync.service';
import { UpdateDeviceDto } from './devices.dto';

type DeviceWithRelations = Device & {
  group?: { id: string; name: string; color: string | null; profile?: { id: string; name: string } | null } | null;
  profile?: { id: string; name: string } | null;
  playlist?: { id: string; name: string } | null;
};

const RELATIONS = {
  // The group's profile too: it is what a device with no profile of its own is using
  group: { select: { id: true, name: true, color: true, profile: { select: { id: true, name: true } } } },
  profile: { select: { id: true, name: true } },
  playlist: { select: { id: true, name: true } },
} satisfies Prisma.DeviceInclude;

@Injectable()
export class DevicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly storage: StorageService,
    private readonly activity: ActivityService,
    private readonly configSync: ConfigSyncService,
    private readonly signage: SignageService,
  ) {}

  /** A list row: never the configuration, the secrets or the API key hash */
  toSummary(d: DeviceWithRelations) {
    return {
      id: d.id,
      name: d.name,
      notes: d.notes,
      group: d.group ?? null,
      profile: d.profile ?? null,
      playlist: d.playlist ?? null,
      model: d.model,
      manufacturer: d.manufacturer,
      androidVersion: d.androidVersion,
      appVersion: d.appVersion,
      formFactor: d.formFactor,
      capabilities: d.capabilities,
      online: d.online,
      lastSeenAt: d.lastSeenAt,
      publicIp: d.publicIp,
      batteryLevel: d.batteryLevel,
      batteryCharging: d.batteryCharging,
      screenOn: d.screenOn,
      brightness: d.brightness,
      wifiSsid: d.wifiSsid,
      wifiSignalDbm: d.wifiSignalDbm,
      ethernet: d.ethernet,
      ipAddress: d.ipAddress,
      currentUrl: d.currentUrl,
      kioskMode: d.kioskMode,
      deviceOwner: d.deviceOwner,
      freeStorageMb: d.freeStorageMb,
      freeMemoryMb: d.freeMemoryMb,
      uptimeSeconds: d.uptimeSeconds,
      timezone: d.timezone,
      configPending: d.pendingConfig !== null || d.pendingSensitiveEnc !== null,
      forceUnenroll: d.forceUnenroll,
      enrolledAt: d.enrolledAt,
      unenrolledAt: d.unenrolledAt,
    };
  }

  async list() {
    const devices = await this.prisma.device.findMany({ include: RELATIONS });
    // Here rather than in the query: the database puts "Tablet 10" before "Tablet 2"
    const byName = new Intl.Collator('vi', { numeric: true });
    return devices.sort((a, b) => byName.compare(a.name, b.name)).map((d) => this.toSummary(d));
  }

  private async mustFind(id: string) {
    const device = await this.prisma.device.findUnique({ where: { id }, include: RELATIONS });
    if (!device) throw new NotFoundException('Không tìm thấy thiết bị');
    return device;
  }

  async detail(id: string) {
    const device = await this.mustFind(id);
    const [openAlerts, signageVersion] = await Promise.all([
      this.prisma.alert.findMany({ where: { deviceId: id, resolvedAt: null }, orderBy: { openedAt: 'desc' } }),
      this.signage.versionFor(id),
    ]);
    return {
      ...this.toSummary(device),
      serialNumber: device.serialNumber,
      utcOffsetMinutes: device.utcOffsetMinutes,
      telemetry: device.telemetry,
      configSyncedAt: device.configSyncedAt,
      reportedConfigAt: device.reportedConfigAt,
      openAlerts,
      signage: {
        wanted: signageVersion,
        reported: device.signagePlaylistVersion,
        state: this.signageState(signageVersion, device.signagePlaylistVersion),
      },
    };
  }

  signageState(wanted: string | null, reported: string | null): 'none' | 'up_to_date' | 'waiting' | 'not_reported' {
    if (reported === null) return wanted ? 'not_reported' : 'none';
    if (!wanted) return reported === '' ? 'none' : 'waiting';
    return reported === wanted ? 'up_to_date' : 'waiting';
  }

  async config(id: string) {
    const device = await this.mustFind(id);
    const pendingSecret = this.crypto.decryptJson<SensitiveValues>(device.pendingSensitiveEnc);
    const reportedSecret = this.crypto.decryptJson<SensitiveValues>(device.reportedSensitiveEnc);
    return {
      reported: device.reportedConfig,
      reportedAt: device.reportedConfigAt,
      pending: device.pendingConfig,
      version: device.configVersion,
      reportedVersion: device.reportedConfigVersion,
      syncedAt: device.configSyncedAt,
      // Whether a secret is set, never its value: the browser has no reason to hold them
      secrets: {
        pinPending: !!pendingSecret?.pin,
        mqttPassword: !!(pendingSecret?.mqttPassword ?? reportedSecret?.mqttPassword),
        restApiKey: !!(pendingSecret?.restApiKey ?? reportedSecret?.restApiKey),
        httpBasicAuthPassword: !!(pendingSecret?.httpBasicAuthPassword ?? reportedSecret?.httpBasicAuthPassword),
      },
    };
  }

  async update(id: string, dto: UpdateDeviceDto, actor: User) {
    const before = await this.mustFind(id);
    const device = await this.prisma.device.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        notes: dto.notes,
        groupId: dto.groupId,
        profileId: dto.profileId,
        playlistId: dto.playlistId,
      },
      include: RELATIONS,
    });

    const profileChanged = dto.profileId !== undefined && dto.profileId !== before.profileId;
    const groupChanged = dto.groupId !== undefined && dto.groupId !== before.groupId;
    if (profileChanged || groupChanged) {
      const profileId = device.profileId ?? (device.groupId ? (await this.prisma.group.findUnique({ where: { id: device.groupId } }))?.profileId : null);
      if (profileId) {
        const profile = await this.prisma.configProfile.findUnique({ where: { id: profileId } });
        if (profile) {
          await this.configSync.push([id], profile.config as Record<string, unknown>, this.crypto.decryptJson<SensitiveValues>(profile.sensitiveEnc));
        }
      }
    }
    if (groupChanged || dto.playlistId !== undefined) this.signage.invalidate();

    await this.activity.log({ action: 'device.updated', message: `${actor.email} đã cập nhật thiết bị ${device.name}`, device, user: actor, data: { ...dto } });
    return this.toSummary(device);
  }

  /** Asks the tablet to leave: it wipes its settings at its next heartbeat, and the row goes then */
  async requestUnenroll(id: string, actor: User): Promise<void> {
    const device = await this.mustFind(id);
    if (device.unenrolledAt) throw new BadRequestException('Thiết bị này đã rời khỏi hệ thống');
    await this.prisma.device.update({ where: { id }, data: { forceUnenroll: true } });
    await this.activity.log({ action: 'device.unenroll_requested', severity: 'warning', message: `${actor.email} yêu cầu hủy đăng ký ${device.name}`, device, user: actor });
  }

  /** Forgets a tablet that is gone. If it ever comes back it is refused, and unenrolls itself */
  async remove(id: string, actor: User): Promise<void> {
    const device = await this.mustFind(id);
    const shots = await this.prisma.screenshot.findMany({ where: { deviceId: id }, select: { storageKey: true } });
    await this.prisma.device.delete({ where: { id } });
    await Promise.all(shots.map((s) => this.storage.remove(s.storageKey)));
    this.signage.forget(id);
    await this.activity.log({ action: 'device.deleted', severity: 'warning', message: `${actor.email} đã xóa thiết bị ${device.name}`, device: { id, name: device.name }, user: actor });
  }
}
