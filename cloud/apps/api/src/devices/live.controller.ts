import { BadRequestException, Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import type { Response } from 'express';
import type { User } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { CurrentUser, Roles } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { LiveInput, LiveMode, LiveService } from './live.service';

export class WatchDto {
  @ApiProperty({ description: 'Mã ngẫu nhiên của trang đang xem' }) @IsString() @Length(8, 64) viewer: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) deviceIds: string[];
  @ApiProperty({ enum: ['grid', 'detail'] }) @IsIn(['grid', 'detail']) mode: LiveMode;
}

export class UnwatchDto {
  @ApiProperty() @IsString() @Length(8, 64) viewer: string;
}

export class LiveInputDto {
  @ApiProperty({ enum: ['tap', 'long_press', 'swipe', 'key', 'text'] }) @IsIn(['tap', 'long_press', 'swipe', 'key', 'text']) type: LiveInput['type'];
  @ApiPropertyOptional({ description: 'Vị trí theo tỉ lệ ảnh, từ 0 đến 1' }) @IsOptional() @IsNumber() @Min(0) @Max(1) x?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) y?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) x2?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) y2?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(3000) ms?: number;
  @ApiPropertyOptional({ enum: ['back', 'home', 'recents', 'enter', 'backspace'] })
  @IsOptional() @IsIn(['back', 'home', 'recents', 'enter', 'backspace']) key?: LiveInput['key'];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) text?: string;
}

/** Someone looking at a classroom's screens is worth one line in the log, not one per refresh */
const LOGGED_FOR_MS = 10 * 60_000;

/**
 * The screens of the Screenshots page, live, and a hand on one of them (LiveService). Operators and
 * administrators only, like a screenshot: a viewer account sees the screenshots already taken.
 */
@ApiTags('Màn hình trực tiếp')
@Controller('api/admin/live')
@Roles('ADMIN', 'OPERATOR')
export class LiveController {
  private readonly logged = new Map<string, number>();

  constructor(
    private readonly live: LiveService,
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  @Post('watch')
  @HttpCode(200)
  async watch(@Body() dto: WatchDto, @CurrentUser() actor: User) {
    const devices = await this.prisma.device.findMany({
      where: { id: { in: dto.deviceIds }, unenrolledAt: null },
      select: { id: true, name: true, online: true, capabilities: true },
    });
    // An older app would only be woken for nothing, every ten seconds
    const able = devices.filter((device) => device.online && device.capabilities.includes('remote_view'));
    const statuses = this.live.watch(`${actor.id}:${dto.viewer}`, able.map((device) => device.id), dto.mode);
    if (dto.mode === 'detail') {
      for (const device of able) {
        const key = `${actor.id}:${device.id}`;
        if ((this.logged.get(key) ?? 0) > Date.now() - LOGGED_FOR_MS) continue;
        this.logged.set(key, Date.now());
        await this.activity.log({ action: 'live.opened', message: `${actor.email} đã mở màn hình trực tiếp của ${device.name}`, device, user: actor });
      }
    }
    return devices.map((device) => {
      const status = statuses.find((s) => s.deviceId === device.id);
      if (status) return { ...status, reason: null };
      return {
        deviceId: device.id,
        streaming: false,
        seq: 0,
        at: null,
        width: null,
        height: null,
        problem: null,
        control: false,
        reason: !device.online ? 'offline' : 'old_app',
      };
    });
  }

  @Post('unwatch')
  @HttpCode(200)
  unwatch(@Body() dto: UnwatchDto, @CurrentUser() actor: User) {
    this.live.unwatch(`${actor.id}:${dto.viewer}`);
    return { ok: true };
  }

  /** The last picture: kept in memory only, and never cached on the way */
  @Get(':deviceId/frame')
  frame(@Param('deviceId', ParseUUIDPipe) deviceId: string, @Res() res: Response) {
    const frame = this.live.latest(deviceId);
    if (!frame) {
      res.status(204).end();
      return;
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Frame-Seq', String(frame.seq));
    res.end(frame.jpeg);
  }

  @Post(':deviceId/input')
  @HttpCode(200)
  input(@Param('deviceId', ParseUUIDPipe) deviceId: string, @Body() dto: LiveInputDto) {
    const { type } = dto;
    const point = dto.x !== undefined && dto.y !== undefined;
    if ((type === 'tap' || type === 'long_press') && !point) throw new BadRequestException('Thiếu vị trí chạm');
    if (type === 'swipe' && (!point || dto.x2 === undefined || dto.y2 === undefined)) throw new BadRequestException('Thiếu vị trí vuốt');
    if (type === 'key' && !dto.key) throw new BadRequestException('Thiếu phím');
    if (type === 'text' && !dto.text) throw new BadRequestException('Thiếu chữ cần gõ');
    this.live.input(deviceId, { type, x: dto.x, y: dto.y, x2: dto.x2, y2: dto.y2, ms: dto.ms, key: dto.key, text: dto.text });
    return { ok: true };
  }
}
