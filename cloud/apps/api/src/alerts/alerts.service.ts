import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Device } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { PrismaService } from '../common/prisma.service';
import { AlertSettings, SettingsService } from '../common/settings.service';
import { CommandsService } from '../devices/commands.service';
import { NotifierService } from './notifier.service';

export const ALERT_TYPES = ['offline', 'battery_low', 'battery_critical', 'storage_low'] as const;
type AlertType = (typeof ALERT_TYPES)[number];

const TITLES: Record<AlertType, string> = {
  offline: 'Thiết bị ngoại tuyến',
  battery_low: 'Pin yếu',
  battery_critical: 'Pin rất yếu',
  storage_low: 'Sắp hết bộ nhớ',
};

/** A device missing two heartbeats (30 seconds apart) is shown offline, before any alert is sent */
const OFFLINE_AFTER_MS = 2 * 60_000;

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly notifier: NotifierService,
    private readonly activity: ActivityService,
    private readonly commands: CommandsService,
  ) {}

  private async open(device: Pick<Device, 'id' | 'name'>, type: AlertType, severity: string, message: string): Promise<void> {
    const { disabled } = await this.settings.alerts();
    if (disabled.includes(type)) return;
    const existing = await this.prisma.alert.findFirst({ where: { deviceId: device.id, type, resolvedAt: null } });
    if (existing) return;
    await this.prisma.alert.create({ data: { deviceId: device.id, type, severity, message } });
    await this.activity.log({ action: `alert.${type}`, severity: 'warning', message: `${device.name}: ${message}`, device });
    void this.notifier.broadcast({
      event: 'alert.opened',
      title: `${TITLES[type]}: ${device.name}`,
      message,
      severity,
      alertType: type,
      device: { id: device.id, name: device.name },
      at: new Date(),
    });
  }

  private async resolve(device: Pick<Device, 'id' | 'name'>, type: AlertType, settings: AlertSettings, message: string): Promise<void> {
    const { count } = await this.prisma.alert.updateMany({
      where: { deviceId: device.id, type, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });
    if (!count || !settings.notifyResolved) return;
    void this.notifier.broadcast({
      event: 'alert.resolved',
      title: `Đã hết cảnh báo: ${device.name}`,
      message,
      severity: 'info',
      alertType: type,
      device: { id: device.id, name: device.name },
      at: new Date(),
    });
  }

  /** The state a heartbeat just brought. Runs after the answer, so it never slows the device down */
  async onHeartbeat(device: Device): Promise<void> {
    try {
      const s = await this.settings.alerts();
      await this.resolve(device, 'offline', s, `${device.name} đã trực tuyến trở lại`);

      const { batteryLevel: level, batteryCharging: charging } = device;
      if (level !== null) {
        if (level <= s.batteryCritical && !charging) {
          await this.open(device, 'battery_critical', 'critical', `Pin còn ${level}%`);
        } else if (level > s.batteryCritical || charging) {
          await this.resolve(device, 'battery_critical', s, `Pin đã phục hồi (${level}%)`);
        }
        if (level <= s.batteryLow && level > s.batteryCritical && !charging) {
          await this.open(device, 'battery_low', 'warning', `Pin còn ${level}%`);
        } else if (level > s.batteryLow || charging || level <= s.batteryCritical) {
          await this.resolve(device, 'battery_low', s, `Pin đã phục hồi (${level}%)`);
        }
      }

      const free = device.freeStorageMb;
      if (free !== null) {
        if (free <= s.storageLowMb) await this.open(device, 'storage_low', 'warning', `Bộ nhớ trống còn ${free} MB`);
        else await this.resolve(device, 'storage_low', s, `Bộ nhớ trống: ${free} MB`);
      }
    } catch (error) {
      this.logger.warn(`Không đánh giá được cảnh báo: ${String(error)}`);
    }
  }

  @Interval(30_000)
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.markOffline();
      await this.commands.expireOld();
    } catch (error) {
      this.logger.warn(`Lỗi khi quét thiết bị: ${String(error)}`);
    } finally {
      this.sweeping = false;
    }
  }

  async markOffline(now = Date.now()): Promise<void> {
    const dropped = await this.prisma.device.findMany({
      where: { online: true, unenrolledAt: null, lastSeenAt: { lt: new Date(now - OFFLINE_AFTER_MS) } },
      select: { id: true, name: true },
    });
    if (dropped.length) {
      await this.prisma.device.updateMany({ where: { id: { in: dropped.map((d) => d.id) } }, data: { online: false } });
      for (const device of dropped) {
        await this.activity.log({ action: 'device.offline', severity: 'warning', message: `${device.name} đã ngoại tuyến`, device });
      }
    }

    const s = await this.settings.alerts();
    const silent = await this.prisma.device.findMany({
      where: { lastSeenAt: { lt: new Date(now - s.offlineMinutes * 60_000) }, forceUnenroll: false, unenrolledAt: null },
      select: { id: true, name: true },
    });
    for (const device of silent) {
      await this.open(device, 'offline', 'warning', `Không nhận được tín hiệu hơn ${s.offlineMinutes} phút`);
    }
  }
}
