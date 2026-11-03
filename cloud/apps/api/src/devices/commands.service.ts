import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, User } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { CryptoService } from '../common/crypto.service';
import { PrismaService } from '../common/prisma.service';
import { TargetDto, targetWhere } from '../common/targets';
import { COMMAND_LABELS, COMMANDS } from './catalog';

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
  ) {}

  async send(options: SendOptions): Promise<SendResult> {
    const { type, target, actor } = options;
    const spec = COMMANDS[type];
    if (!spec) throw new BadRequestException(`Lệnh không được hỗ trợ: ${type}`);
    if (spec.adminOnly && actor && actor.role !== 'ADMIN') {
      throw new ForbiddenException('Chỉ quản trị viên mới được gửi lệnh này');
    }
    const params = { ...(options.params ?? {}) };
    const problem = spec.validate?.(params);
    if (problem) throw new BadRequestException(problem);

    const where = targetWhere(target);
    if (!where) throw new BadRequestException('Chưa chọn thiết bị');
    const devices = await this.prisma.device.findMany({
      where,
      select: { id: true, name: true, capabilities: true },
    });

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
        skipped.push({ deviceId: device.id, name: device.name, reason: 'Thiết bị không hỗ trợ lệnh này' });
        return false;
      }
      return true;
    });

    if (reachable.length) {
      const expiresAt = new Date(Date.now() + (options.ttlMinutes ?? DEFAULT_TTL_MINUTES) * 60_000);
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
    }

    const label = COMMAND_LABELS[type] ?? type;
    const single = reachable.length === 1 ? reachable[0] : null;
    await this.activity.log({
      action: 'command.queued',
      message: `${actor?.email ?? 'Lịch hẹn giờ'} gửi lệnh "${label}" tới ${single ? single.name : `${reachable.length} thiết bị`}`,
      device: single,
      user: actor,
      data: { type, batchId, count: reachable.length, skipped: skipped.length },
    });
    return { batchId, sent: reachable.length, skipped };
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
