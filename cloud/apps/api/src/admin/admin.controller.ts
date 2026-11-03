import { Body, Controller, Get, Header, Injectable, Patch, Put, Query, Res } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { Response } from 'express';
import { CryptoService } from '../common/crypto.service';
import { csvCell, Roles } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { StorageService } from '../common/storage.service';
import { env } from '../config/env';

const LOG_RETENTION_DAYS = 365;
const SCREENSHOT_RETENTION_DAYS = 30;
const COMMAND_RETENTION_DAYS = 90;

export class OrganizationDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
}

export class SmtpDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) host: string;
  @ApiProperty() @IsInt() @Min(1) @Max(65535) port: number;
  @ApiProperty() @IsBoolean() secure: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) user?: string;
  @ApiPropertyOptional({ description: 'Để trống để giữ mật khẩu cũ' }) @IsOptional() @IsString() @MaxLength(200) password?: string;
  @ApiProperty() @IsEmail() from: string;
}

function activityWhere(query: { deviceId?: string; action?: string; severity?: string; from?: string; to?: string; search?: string }) {
  return {
    deviceId: query.deviceId || undefined,
    action: query.action ? { startsWith: query.action } : undefined,
    severity: query.severity || undefined,
    message: query.search ? { contains: query.search, mode: 'insensitive' as const } : undefined,
    createdAt:
      query.from || query.to
        ? { gte: query.from ? new Date(query.from) : undefined, lte: query.to ? new Date(query.to) : undefined }
        : undefined,
  };
}

@ApiTags('Tổng quan')
@Controller('api/admin')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly crypto: CryptoService,
  ) {}

  @Get('overview')
  async overview() {
    const [devices, groups, alerts, recent, pendingCommands, playlists] = await Promise.all([
      this.prisma.device.findMany({
        where: { unenrolledAt: null },
        select: {
          id: true, name: true, online: true, lastSeenAt: true, batteryLevel: true, batteryCharging: true,
          freeStorageMb: true, appVersion: true, androidVersion: true, formFactor: true, deviceOwner: true,
          screenOn: true, groupId: true,
        },
      }),
      this.prisma.group.findMany({ select: { id: true, name: true, color: true } }),
      this.prisma.alert.findMany({
        where: { resolvedAt: null },
        orderBy: { openedAt: 'desc' },
        take: 8,
        include: { device: { select: { id: true, name: true } } },
      }),
      this.prisma.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
      this.prisma.command.count({ where: { status: { in: ['PENDING', 'SENT'] } } }),
      this.prisma.playlist.count(),
    ]);
    const levels = devices.map((d) => d.batteryLevel).filter((l): l is number => l !== null);
    const count = (values: Array<string | null>) => {
      const map = new Map<string, number>();
      for (const value of values) map.set(value ?? 'Không rõ', (map.get(value ?? 'Không rõ') ?? 0) + 1);
      return [...map.entries()].map(([label, total]) => ({ label, total })).sort((a, b) => b.total - a.total);
    };
    return {
      totals: {
        devices: devices.length,
        online: devices.filter((d) => d.online).length,
        offline: devices.filter((d) => !d.online).length,
        screensOff: devices.filter((d) => d.online && d.screenOn === false).length,
        deviceOwner: devices.filter((d) => d.deviceOwner).length,
        averageBattery: levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : null,
        openAlerts: await this.prisma.alert.count({ where: { resolvedAt: null } }),
        pendingCommands,
        groups: groups.length,
        playlists,
      },
      appVersions: count(devices.map((d) => d.appVersion)),
      androidVersions: count(devices.map((d) => d.androidVersion)),
      groups: groups.map((g) => {
        const members = devices.filter((d) => d.groupId === g.id);
        return { ...g, total: members.length, online: members.filter((d) => d.online).length };
      }),
      alerts,
      recent,
    };
  }

  // ─── Activity log ─────────────────────────────────────────────────────────

  @Get('activity')
  activity(
    @Query('deviceId') deviceId?: string,
    @Query('action') action?: string,
    @Query('severity') severity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.prisma.activityLog.findMany({
      where: activityWhere({ deviceId, action, severity, from, to, search }),
      orderBy: { id: 'desc' },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  @Get('activity/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="nhat-ky-hoat-dong.csv"')
  async exportActivity(
    @Res() res: Response,
    @Query('deviceId') deviceId?: string,
    @Query('action') action?: string,
    @Query('severity') severity?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    const rows = await this.prisma.activityLog.findMany({
      where: activityWhere({ deviceId, action, severity, from, to, search }),
      orderBy: { id: 'desc' },
      take: 50_000,
    });
    const header = ['Thời gian', 'Mức độ', 'Hành động', 'Nội dung', 'Thiết bị', 'Người dùng', 'IP'];
    const lines = rows.map((r) =>
      [r.createdAt, r.severity, r.action, r.message, r.deviceName, r.userEmail, r.ip].map(csvCell).join(','),
    );
    // The byte order mark is what makes Excel read Vietnamese correctly
    res.send(`﻿${[header.join(','), ...lines].join('\r\n')}`);
  }

  // ─── Settings ─────────────────────────────────────────────────────────────

  @Get('settings')
  async getSettings() {
    const [organization, smtp] = await Promise.all([this.settings.organization(), this.settings.smtp()]);
    const { publicUrl, mediaQuotaGb } = env();
    return {
      organization,
      publicUrl,
      mediaQuotaGb,
      smtp: smtp ? { host: smtp.host, port: smtp.port, secure: smtp.secure, user: smtp.user, from: smtp.from, hasPassword: !!smtp.passwordEnc } : null,
    };
  }

  @Patch('settings/organization')
  @Roles('ADMIN')
  saveOrganization(@Body() dto: OrganizationDto) {
    return this.settings.saveOrganization(dto.name.trim());
  }

  @Put('settings/smtp')
  @Roles('ADMIN')
  async saveSmtp(@Body() dto: SmtpDto) {
    const before = await this.settings.smtp();
    await this.settings.saveSmtp({
      host: dto.host.trim(),
      port: dto.port,
      secure: dto.secure,
      user: dto.user?.trim() ?? '',
      passwordEnc: dto.password ? this.crypto.encrypt(dto.password) : (before?.passwordEnc ?? null),
      from: dto.from,
    });
    return { ok: true };
  }
}

/** Keeps the database and the disk from growing without end */
@Injectable()
export class RetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Interval(6 * 3_600_000)
  async clean(): Promise<void> {
    const day = 86_400_000;
    const now = Date.now();
    await this.prisma.activityLog.deleteMany({ where: { createdAt: { lt: new Date(now - LOG_RETENTION_DAYS * day) } } });
    await this.prisma.command.deleteMany({ where: { createdAt: { lt: new Date(now - COMMAND_RETENTION_DAYS * day) } } });
    await this.prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    await this.prisma.alert.deleteMany({ where: { resolvedAt: { lt: new Date(now - LOG_RETENTION_DAYS * day) } } });
    const shots = await this.prisma.screenshot.findMany({ where: { createdAt: { lt: new Date(now - SCREENSHOT_RETENTION_DAYS * day) } } });
    if (shots.length) {
      await this.prisma.screenshot.deleteMany({ where: { id: { in: shots.map((s) => s.id) } } });
      await Promise.all(shots.map((s) => this.storage.remove(s.storageKey)));
    }
  }
}
