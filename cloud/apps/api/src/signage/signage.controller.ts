import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import type { User } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { DeviceWakeService } from '../common/device-wake.service';
import { CurrentUser, Roles } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { parseYoutubeId, SignageService } from './signage.service';

export class SavePlaylistDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
}

export class PlaylistItemDto {
  @ApiProperty({ enum: ['video', 'image', 'web', 'youtube'] }) @IsIn(['video', 'image', 'web', 'youtube']) kind: string;
  @ApiPropertyOptional({ description: 'Địa chỉ của video, ảnh, trang web, hoặc liên kết YouTube' })
  @IsOptional() @IsString() @MaxLength(2000) url?: string;
  @ApiPropertyOptional({ description: 'Tệp trong thư viện, thay cho URL' })
  @IsOptional() @IsUUID() mediaAssetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiPropertyOptional({ description: 'Số giây hiển thị' })
  @IsOptional() @IsInt() @Min(1) @Max(86400) durationSeconds?: number;
}

export class ReplaceItemsDto {
  @ApiProperty({ type: [PlaylistItemDto] })
  @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => PlaylistItemDto)
  items: PlaylistItemDto[];
}

export class AssignDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(5000) @IsUUID(undefined, { each: true }) deviceIds: string[];
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(1000) @IsUUID(undefined, { each: true }) groupIds: string[];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ScheduleRuleDto {
  @ApiProperty() @IsUUID() playlistId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() deviceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() groupId?: string;
  @ApiProperty({ type: [Number], description: 'Thứ theo ISO: thứ Hai là 1, Chủ nhật là 7' })
  @IsArray() @ArrayMinSize(1) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) days: number[];
  @ApiPropertyOptional() @IsOptional() @Matches(TIME) start?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(TIME) end?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) from?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) to?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) priority?: number;
}

export class CheckUrlDto {
  @ApiProperty() @IsString() @MaxLength(2000) url: string;
}

const WEB_MIN_SECONDS = 5;
const WEB_MAX_SECONDS = 3600;
/** Time for the word to reach the screens and for them to load the first item, so they start together */
const START_LEAD_MS = 6_000;
const startSoon = () => new Date(Date.now() + START_LEAD_MS);

@ApiTags('Trình phát video/ảnh')
@Controller('api/admin/signage')
export class SignageController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly signage: SignageService,
    private readonly activity: ActivityService,
    private readonly wake: DeviceWakeService,
  ) {}

  /** What screens play changed: they hear of it now rather than at their next heartbeat */
  private changed(): void {
    this.signage.invalidate();
    this.wake.notifyConnected('config');
  }

  /** Every screen with what it should play and what it says it plays */
  @Get('screens')
  async screens() {
    const devices = await this.prisma.device.findMany({
      where: { unenrolledAt: null },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, online: true, lastSeenAt: true, formFactor: true, signagePlaylistVersion: true, capabilities: true,
        playlist: { select: { id: true, name: true } },
        group: { select: { id: true, name: true, playlist: { select: { id: true, name: true } } } },
        _count: { select: { rules: true } },
      },
    });
    return Promise.all(
      devices.map(async (device) => {
        const wanted = await this.signage.versionFor(device.id);
        const reported = device.signagePlaylistVersion;
        const state = !wanted && !reported ? 'none' : reported === null ? 'not_reported' : (reported || null) === wanted ? 'up_to_date' : 'waiting';
        return {
          id: device.id,
          name: device.name,
          online: device.online,
          lastSeenAt: device.lastSeenAt,
          formFactor: device.formFactor,
          playlist: device.playlist,
          groupName: device.group?.name ?? null,
          groupPlaylist: device.group?.playlist ?? null,
          ruleCount: device._count.rules,
          state,
        };
      }),
    );
  }

  @Get('playlists')
  async playlists() {
    const rows = await this.prisma.playlist.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { items: true, devices: true, groups: true, rules: true } },
        items: { take: 1, orderBy: { position: 'asc' }, select: { kind: true, url: true, mediaAsset: { select: { id: true, fileName: true, kind: true } } } },
      },
    });
    return rows.map(({ items, ...row }) => ({
      ...row,
      cover: items[0]?.mediaAsset?.kind === 'image' ? this.signage.mediaUrl(items[0].mediaAsset) : items[0]?.kind === 'image' ? items[0].url : null,
    }));
  }

  private async mustFindPlaylist(id: string) {
    const playlist = await this.prisma.playlist.findUnique({
      where: { id },
      include: {
        items: { orderBy: { position: 'asc' }, include: { mediaAsset: { select: { id: true, fileName: true, title: true, kind: true, sizeBytes: true } } } },
        devices: { where: { unenrolledAt: null }, select: { id: true, name: true, online: true, signagePlaylistVersion: true, capabilities: true } },
        groups: { select: { id: true, name: true } },
        rules: { orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], include: { device: { select: { id: true, name: true } }, group: { select: { id: true, name: true } } } },
      },
    });
    if (!playlist) throw new NotFoundException('Không tìm thấy danh sách phát');
    return playlist;
  }

  /** The screens this playlist reaches, with what each one says it plays */
  @Get('playlists/:id')
  async playlist(@Param('id', ParseUUIDPipe) id: string) {
    const playlist = await this.mustFindPlaylist(id);
    const groupIds = playlist.groups.map((g) => g.id);
    const viaGroup = groupIds.length
      ? await this.prisma.device.findMany({
          where: { groupId: { in: groupIds }, playlistId: null, unenrolledAt: null },
          select: { id: true, name: true, online: true, signagePlaylistVersion: true, capabilities: true },
        })
      : [];
    const needs = new Set(playlist.items.flatMap((i) => (i.kind === 'web' ? ['signage_web'] : i.kind === 'youtube' ? ['signage_youtube'] : [])));
    const screens = await Promise.all(
      [...playlist.devices, ...viaGroup].map(async (device) => {
        const wanted = await this.signage.versionFor(device.id);
        const reported = device.signagePlaylistVersion;
        const tooOld = device.capabilities.length > 0 && [...needs].some((c) => !device.capabilities.includes(c));
        const state = tooOld ? 'app_too_old' : reported === null ? 'not_reported' : reported === wanted ? 'up_to_date' : 'waiting';
        // It plays the list, but on its own time
        const inStep = device.capabilities.includes('signage_sync');
        return { id: device.id, name: device.name, online: device.online, state, inStep };
      }),
    );
    const items = playlist.items.map((item) => ({
      ...item,
      previewUrl: item.mediaAsset ? this.signage.mediaUrl(item.mediaAsset) : item.url,
    }));
    return { ...playlist, items, screens };
  }

  @Post('playlists')
  @Roles('ADMIN', 'OPERATOR')
  async create(@Body() dto: SavePlaylistDto, @CurrentUser() actor: User) {
    const playlist = await this.prisma.playlist.create({ data: { name: dto.name.trim(), description: dto.description } });
    await this.activity.log({ action: 'playlist.created', message: `${actor.email} đã tạo danh sách phát ${playlist.name}`, user: actor });
    return playlist;
  }

  @Patch('playlists/:id')
  @Roles('ADMIN', 'OPERATOR')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SavePlaylistDto) {
    const playlist = await this.prisma.playlist.update({ where: { id }, data: { name: dto.name.trim(), description: dto.description } });
    this.changed();
    return playlist;
  }

  @Delete('playlists/:id')
  @Roles('ADMIN', 'OPERATOR')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const playlist = await this.prisma.playlist.findUnique({ where: { id } });
    if (!playlist) throw new NotFoundException('Không tìm thấy danh sách phát');
    await this.prisma.playlist.delete({ where: { id } });
    this.changed();
    await this.activity.log({ action: 'playlist.deleted', severity: 'warning', message: `${actor.email} đã xóa danh sách phát ${playlist.name}`, user: actor });
    return { ok: true };
  }

  private normalizeItem(dto: PlaylistItemDto, index: number) {
    const base = { position: index, kind: dto.kind, title: dto.title?.trim() || null };
    if (dto.kind === 'youtube') {
      const videoId = parseYoutubeId(dto.url ?? '');
      if (!videoId) throw new BadRequestException(`Mục ${index + 1}: liên kết YouTube không hợp lệ`);
      return { ...base, videoId, url: dto.url!.trim(), durationSeconds: dto.durationSeconds ?? null };
    }
    if (dto.mediaAssetId) {
      if (dto.kind === 'web') throw new BadRequestException(`Mục ${index + 1}: trang web phải là một địa chỉ URL`);
      return { ...base, mediaAssetId: dto.mediaAssetId, durationSeconds: dto.kind === 'image' ? (dto.durationSeconds ?? null) : null };
    }
    const url = dto.url?.trim() ?? '';
    if (!/^https?:\/\/\S+$/i.test(url)) throw new BadRequestException(`Mục ${index + 1}: URL phải bắt đầu bằng http:// hoặc https://`);
    if (dto.kind === 'web') {
      const seconds = Math.min(Math.max(dto.durationSeconds ?? 30, WEB_MIN_SECONDS), WEB_MAX_SECONDS);
      return { ...base, url, durationSeconds: seconds };
    }
    return { ...base, url, durationSeconds: dto.kind === 'image' ? (dto.durationSeconds ?? null) : null };
  }

  /** The whole list at once: adding, removing and reordering are one operation for the page */
  @Put('playlists/:id/items')
  @Roles('ADMIN', 'OPERATOR')
  async replaceItems(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplaceItemsDto, @CurrentUser() actor: User) {
    const playlist = await this.mustFindPlaylist(id);
    const items = dto.items.map((item, index) => this.normalizeItem(item, index));
    await this.prisma.$transaction([
      this.prisma.playlistItem.deleteMany({ where: { playlistId: id } }),
      this.prisma.playlistItem.createMany({ data: items.map((item) => ({ ...item, playlistId: id })) }),
      // New content starts from its first item, everywhere at once
      this.prisma.playlist.update({ where: { id }, data: { updatedAt: new Date(), syncEpochAt: startSoon() } }),
    ]);
    this.changed();
    await this.activity.log({ action: 'playlist.updated', message: `${actor.email} đã sửa danh sách phát ${playlist.name} (${items.length} mục)`, user: actor });
    return this.playlist(id);
  }

  @Put('playlists/:id/assign')
  @Roles('ADMIN', 'OPERATOR')
  async assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignDto, @CurrentUser() actor: User) {
    const playlist = await this.mustFindPlaylist(id);
    await this.prisma.$transaction([
      this.prisma.device.updateMany({ where: { playlistId: id, id: { notIn: dto.deviceIds } }, data: { playlistId: null } }),
      this.prisma.device.updateMany({ where: { id: { in: dto.deviceIds } }, data: { playlistId: id } }),
      this.prisma.group.updateMany({ where: { playlistId: id, id: { notIn: dto.groupIds } }, data: { playlistId: null } }),
      this.prisma.group.updateMany({ where: { id: { in: dto.groupIds } }, data: { playlistId: id } }),
      // Nobody was playing it: it starts from its first item. Screens added to a list already playing
      // join it where it is, so that the others are not sent back to the start
      ...(playlist.devices.length === 0 && playlist.groups.length === 0
        ? [this.prisma.playlist.update({ where: { id }, data: { syncEpochAt: startSoon() } })]
        : []),
    ]);
    this.changed();
    await this.activity.log({
      action: 'playlist.assigned',
      message: `${actor.email} đã gán ${playlist.name} cho ${dto.deviceIds.length} thiết bị và ${dto.groupIds.length} nhóm`,
      user: actor,
    });
    return this.playlist(id);
  }

  /** Every screen playing the list goes back to its first item, at the same moment */
  @Post('playlists/:id/restart')
  @HttpCode(200)
  @Roles('ADMIN', 'OPERATOR')
  async restart(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const playlist = await this.mustFindPlaylist(id);
    await this.prisma.playlist.update({ where: { id }, data: { syncEpochAt: startSoon() } });
    this.changed();
    await this.activity.log({ action: 'playlist.restarted', message: `${actor.email} đã cho phát lại từ đầu danh sách ${playlist.name}`, user: actor });
    return { ok: true };
  }

  private checkRule(dto: ScheduleRuleDto): void {
    if (!!dto.deviceId === !!dto.groupId) throw new BadRequestException('Lịch phải gán cho đúng một thiết bị hoặc một nhóm');
    if (!!dto.start !== !!dto.end) throw new BadRequestException('Cần nhập cả giờ bắt đầu và giờ kết thúc, hoặc để trống cả hai');
    if (dto.start && dto.start === dto.end) throw new BadRequestException('Giờ bắt đầu và giờ kết thúc phải khác nhau');
    if (dto.from && dto.to && dto.from > dto.to) throw new BadRequestException('Ngày bắt đầu phải trước ngày kết thúc');
  }

  @Post('rules')
  @Roles('ADMIN', 'OPERATOR')
  async createRule(@Body() dto: ScheduleRuleDto, @CurrentUser() actor: User) {
    this.checkRule(dto);
    const rule = await this.prisma.scheduleRule.create({
      data: {
        playlistId: dto.playlistId,
        deviceId: dto.deviceId,
        groupId: dto.groupId,
        days: [...new Set(dto.days)].sort(),
        start: dto.start ?? null,
        end: dto.end ?? null,
        from: dto.from ?? null,
        to: dto.to ?? null,
        priority: dto.priority ?? 0,
      },
    });
    this.changed();
    await this.activity.log({ action: 'schedule.created', message: `${actor.email} đã thêm một lịch phát`, user: actor });
    return rule;
  }

  @Delete('rules/:id')
  @Roles('ADMIN', 'OPERATOR')
  async removeRule(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    await this.prisma.scheduleRule.delete({ where: { id } });
    this.changed();
    await this.activity.log({ action: 'schedule.deleted', message: `${actor.email} đã xóa một lịch phát`, user: actor });
    return { ok: true };
  }

  @Post('check-url')
  @HttpCode(200)
  @Roles('ADMIN', 'OPERATOR')
  checkUrl(@Body() dto: CheckUrlDto) {
    return this.signage.checkFraming(dto.url);
  }
}
