import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, User } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { CryptoService } from '../common/crypto.service';
import { DeviceWakeService } from '../common/device-wake.service';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { TargetDto, targetWhere } from '../common/targets';
import { COMMAND_LABELS, COMMANDS, CONFIG_COMMANDS, ConfigCommandSpec } from './catalog';
import { ConfigSyncService } from './config-sync.service';

const DEFAULT_TTL_MINUTES = 60;

export interface SendOptions {
  type: string;
  params?: Record<string, unknown>;
  target: TargetDto;
  ttlMinutes?: number;
  actor?: User | null;
  source?: string;
}

export interface SendResult {
  batchId: string;
  sent: number;
  skipped: Array<{ deviceId: string; name: string; reason: string }>;
}

@Injectable()
export class CommandsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly activity: ActivityService,
    private readonly configSync: ConfigSyncService,
    private readonly wake: DeviceWakeService,
    private readonly settings: SettingsService,
  ) {}

  async send(options: SendOptions): Promise<SendResult> {
    const { type, target, actor } = options;
    if (Object.hasOwn(CONFIG_COMMANDS, type)) return this.sendThroughConfig(CONFIG_COMMANDS[type], options);
    const spec = Object.hasOwn(COMMANDS, type) ? COMMANDS[type] : null;
    if (!spec) throw new BadRequestException(`Lệnh không được hỗ trợ: ${type}`);
    if (spec.adminOnly && actor && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ quản trị viên mới được gửi lệnh này');
    }
    const params = { ...(options.params ?? {}) };
    const problem = spec.validate?.(params);
    if (problem) throw new BadRequestException(problem);
    // A tablet asked where it is turns location on: not once the website has stopped asking
    if (type === 'locate' && !(await this.settings.location()).enabled) {
      throw new BadRequestException('Thu thập vị trí đang tắt: bật lại ở trang Bản đồ');
    }

    const where = targetWhere(target);
    if (!where) throw new BadRequestException('Chưa chọn thiết bị');
    const devices = await this.prisma.device.findMany({
      where,
      select: { id: true, name: true, capabilities: true },
    });
    if (spec.singleDevice && devices.length > 1) throw new BadRequestException('Lệnh này chỉ gửi cho một thiết bị mỗi lần');

    const secret: Record<string, unknown> = {};
    for (const name of spec.secretParams ?? []) {
      if (params[name] !== undefined) secret[name] = params[name];
      delete params[name];
    }

    const batchId = randomUUID();
    const skipped: SendResult['skipped'] = [];
    const reachable = devices.filter((device) => {
      const caps = device.capabilities;
      if (spec.capability && caps.length > 0 && !caps.includes(spec.capability)) {
        skipped.push({ deviceId: device.id, name: device.name, reason: spec.lacking ?? 'Thiết bị không hỗ trợ lệnh này' });
        return false;
      }
      return true;
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + (options.ttlMinutes ?? spec.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60_000);
    if (skipped.length) {
      await this.prisma.command.createMany({
        data: skipped.map((line) => ({
          deviceId: line.deviceId,
          type,
          params: params as Prisma.InputJsonValue,
          status: 'ERROR' as const,
          errorMessage: line.reason,
          batchId,
          source: options.source ?? 'manual',
          createdById: actor?.id,
          createdBy: actor?.email,
          completedAt: now,
          expiresAt,
        })),
      });
    }

    if (reachable.length) {
      const secretEnc = Object.keys(secret).length ? this.crypto.encryptJson(secret) : null;
      await this.prisma.command.createMany({
        data: reachable.map((device) => ({
          deviceId: device.id,
          type,
          params: params as Prisma.InputJsonValue,
          secretEnc,
          batchId,
          source: options.source ?? 'manual',
          createdById: actor?.id,
          createdBy: actor?.email,
          expiresAt,
        })),
      });
      this.wake.notify(reachable.map((device) => device.id), 'commands');
    }

    await this.logQueued(type, actor, reachable, batchId, skipped.length);
    return { batchId, sent: reachable.length, skipped };
  }

  /**
   * Reaches a tablet through its configuration, so there is nothing for it to run or answer: the
   * line in the history starts as sent, and the heartbeat that confirms the change closes it.
   */
  private async sendThroughConfig(spec: ConfigCommandSpec, options: SendOptions): Promise<SendResult> {
    const { type, target, actor } = options;
    const params = options.params ?? {};
    const problem = spec.validate(params);
    if (problem) throw new BadRequestException(problem);

    const where = targetWhere(target);
    if (!where) throw new BadRequestException('Chưa chọn thiết bị');
    const devices = await this.prisma.device.findMany({ where, select: { id: true, name: true } });

    const batchId = randomUUID();
    await this.configSync.push(devices.map((device) => device.id), spec.config(params), undefined, { type, params, actor, batchId, source: options.source });

    await this.logQueued(type, actor, devices, batchId, 0);
    return { batchId, sent: devices.length, skipped: [] };
  }

  private async logQueued(type: string, actor: User | null | undefined, devices: Array<{ id: string; name: string }>, batchId: string, skipped: number): Promise<void> {
    const label = COMMAND_LABELS[type] ?? type;
    const single = devices.length === 1 ? devices[0] : null;
    await this.activity.log({
      action: 'command.queued',
      message: `${actor?.email ?? 'Lịch hẹn giờ'} gửi lệnh "${label}" tới ${single ? single.name : `${devices.length} thiết bị`}${skipped ? `, bỏ qua ${skipped} thiết bị` : ''}`,
      device: single,
      user: actor,
      data: { type, batchId, count: devices.length, skipped },
    });
  }

  /** Commands the device has not run in time will never run */
  async expireOld(): Promise<number> {
    const { count } = await this.prisma.command.updateMany({
      where: { status: { in: ['PENDING', 'SENT'] }, expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED', secretEnc: null, completedAt: new Date() },
    });
    return count;
  }
}
