import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { User } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { CurrentUser, Roles, sendStoredFile } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { targetWhere } from '../common/targets';
import { COMMAND_LABELS, COMMANDS } from './catalog';
import { CommandsService } from './commands.service';
import { ConfigSyncService } from './config-sync.service';
import { ApplyConfigDto, ListCommandsQuery, SendCommandDto, UpdateConfigDto, UpdateDeviceDto } from './devices.dto';
import { DevicesService } from './devices.service';

@ApiTags('Thiết bị')
@Controller('api/admin/devices')
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly prisma: PrismaService,
    private readonly configSync: ConfigSyncService,
    private readonly activity: ActivityService,
  ) {}

  @Get()
  list() {
    return this.devices.list();
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.detail(id);
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATOR')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateDeviceDto, @CurrentUser() actor: User) {
    return this.devices.update(id, dto, actor);
  }

  @Post(':id/unenroll')
  @HttpCode(200)
  @Roles('ADMIN')
  async unenroll(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    await this.devices.requestUnenroll(id, actor);
    return { ok: true };
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    await this.devices.remove(id, actor);
    return { ok: true };
  }

  @Get(':id/config')
  config(@Param('id', ParseUUIDPipe) id: string) {
    return this.devices.config(id);
  }

  @Patch(':id/config')
  @Roles('ADMIN', 'OPERATOR')
  async updateConfig(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConfigDto, @CurrentUser() actor: User) {
    const device = await this.prisma.device.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!device) throw new NotFoundException('Không tìm thấy thiết bị');
    await this.configSync.push([id], dto.config ?? {}, dto.sensitive);
    await this.activity.log({
      action: 'config.changed',
      message: `${actor.email} đã đổi cấu hình của ${device.name}`,
      device,
      user: actor,
      data: { keys: Object.keys(dto.config ?? {}), secrets: Object.keys(dto.sensitive ?? {}) },
    });
    return this.devices.config(id);
  }

  @Get(':id/activity')
  activityOf(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.activityLog.findMany({ where: { deviceId: id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }
}

@ApiTags('Cấu hình')
@Controller('api/admin/config')
export class ConfigController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configSync: ConfigSyncService,
    private readonly activity: ActivityService,
  ) {}

  @Post('apply')
  @HttpCode(200)
  @Roles('ADMIN', 'OPERATOR')
  async apply(@Body() dto: ApplyConfigDto, @CurrentUser() actor: User) {
    const where = targetWhere(dto.target);
    if (!where) throw new BadRequestException('Chưa chọn thiết bị');
    const devices = await this.prisma.device.findMany({ where, select: { id: true } });
    const count = await this.configSync.push(devices.map((d) => d.id), dto.config ?? {}, dto.sensitive);
    await this.activity.log({
      action: 'config.changed',
      message: `${actor.email} đã đổi cấu hình của ${count} thiết bị`,
      user: actor,
      data: { keys: Object.keys(dto.config ?? {}), secrets: Object.keys(dto.sensitive ?? {}) },
    });
    return { count };
  }
}

@ApiTags('Lệnh')
@Controller('api/admin/commands')
export class CommandsController {
  constructor(
    private readonly commands: CommandsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('catalog')
  catalog() {
    return Object.entries(COMMANDS).map(([type, spec]) => ({
      type,
      label: COMMAND_LABELS[type] ?? type,
      capability: spec.capability ?? null,
      adminOnly: !!spec.adminOnly,
    }));
  }

  @Post()
  @Roles('ADMIN', 'OPERATOR')
  send(@Body() dto: SendCommandDto, @CurrentUser() actor: User) {
    return this.commands.send({ type: dto.type, params: dto.params, target: dto.target, ttlMinutes: dto.ttlMinutes, actor });
  }

  @Get()
  async list(@Query() query: ListCommandsQuery) {
    const rows = await this.prisma.command.findMany({
      where: { deviceId: query.deviceId, batchId: query.batchId },
      orderBy: { createdAt: 'desc' },
      take: query.take ?? 200,
      include: { device: { select: { id: true, name: true } } },
    });
    return rows.map(({ secretEnc: _secret, ...row }) => row);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('ADMIN', 'OPERATOR')
  async cancel(@Param('id', ParseUUIDPipe) id: string) {
    const { count } = await this.prisma.command.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'CANCELLED', secretEnc: null, completedAt: new Date() },
    });
    if (!count) throw new BadRequestException('Lệnh đã được gửi tới thiết bị, không thể hủy');
    return { ok: true };
  }
}

@ApiTags('Ảnh màn hình')
@Controller('api/admin/screenshots')
export class ScreenshotsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  list(@Query('deviceId') deviceId?: string) {
    if (deviceId && !/^[0-9a-f-]{36}$/i.test(deviceId)) throw new ForbiddenException();
    return this.prisma.screenshot.findMany({
      where: { deviceId: deviceId || undefined },
      orderBy: { createdAt: 'desc' },
      take: 120,
      select: { id: true, deviceId: true, capturedAt: true, createdAt: true, sizeBytes: true, device: { select: { name: true } } },
    });
  }

  /** Only through a session: what is on a screen can be private */
  @Get(':id/image')
  async image(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const shot = await this.prisma.screenshot.findUnique({ where: { id } });
    if (!shot) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.type('image/png');
    sendStoredFile(res, this.storage.path(shot.storageKey));
  }

  @Delete(':id')
  @Roles('ADMIN', 'OPERATOR')
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const shot = await this.prisma.screenshot.findUnique({ where: { id } });
    if (!shot) throw new NotFoundException();
    await this.prisma.screenshot.delete({ where: { id } });
    await this.storage.remove(shot.storageKey);
    return { ok: true };
  }
}
