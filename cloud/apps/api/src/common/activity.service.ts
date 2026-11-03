import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from './prisma.service';

export interface ActivityEntry {
  action: string;
  message: string;
  severity?: 'info' | 'warning' | 'error';
  device?: { id: string; name: string } | null;
  user?: { id: string; email: string } | null;
  ip?: string | null;
  data?: Prisma.InputJsonValue;
}

@Injectable()
export class ActivityService {
  private readonly logger = new Logger(ActivityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Best-effort: a log line that cannot be written must never fail the action it describes */
  async log(entry: ActivityEntry): Promise<void> {
    try {
      await this.prisma.activityLog.create({
        data: {
          action: entry.action,
          message: entry.message,
          severity: entry.severity ?? 'info',
          deviceId: entry.device?.id,
          deviceName: entry.device?.name,
          userId: entry.user?.id,
          userEmail: entry.user?.email,
          ip: entry.ip ?? undefined,
          data: entry.data,
        },
      });
    } catch (error) {
      this.logger.warn(`Không ghi được nhật ký ${entry.action}: ${String(error)}`);
    }
  }
}
