import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import type { AlertChannel } from '../generated/prisma/client';
import { CryptoService } from '../common/crypto.service';
import { Roles } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { NotifierService } from './notifier.service';

export class ChannelConfigDto {
  @ApiPropertyOptional({ type: [String], description: 'Email: danh sách người nhận' })
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsEmail({}, { each: true }) to?: string[];
  @ApiPropertyOptional({ description: 'Webhook: địa chỉ nhận' })
  @IsOptional() @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }) url?: string;
  @ApiPropertyOptional({ description: 'Webhook: khóa ký HMAC-SHA256' })
  @IsOptional() @IsString() @MaxLength(200) secret?: string;
  @ApiPropertyOptional({ enum: ['generic', 'slack', 'discord'] }) @IsOptional() @IsIn(['generic', 'slack', 'discord']) format?: string;
  @ApiPropertyOptional({ description: 'ntfy: máy chủ, ví dụ https://ntfy.sh' })
  @IsOptional() @IsUrl({ require_tld: false, require_protocol: true, protocols: ['http', 'https'] }) server?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) topic?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) token?: string;
}

export class SaveChannelDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiProperty({ enum: ['email', 'webhook', 'ntfy'] }) @IsIn(['email', 'webhook', 'ntfy']) type: string;
  @ApiProperty({ type: ChannelConfigDto }) @ValidateNested() @Type(() => ChannelConfigDto) config: ChannelConfigDto;
  @ApiPropertyOptional({ type: [String], description: 'Loại cảnh báo nhận; để trống là nhận tất cả' })
  @IsOptional() @IsArray() @IsString({ each: true }) events?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}

export class AlertSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(2) @Max(1440) offlineMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100) batteryLow?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100) batteryCritical?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1_000_000) storageLowMb?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyResolved?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) disabled?: string[];
}

@ApiTags('Cảnh báo')
@Controller('api/admin/alerts')
export class AlertsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly notifier: NotifierService,
  ) {}

  @Get()
  list(@Query('state') state?: string) {
    return this.prisma.alert.findMany({
      where: state === 'open' ? { resolvedAt: null } : undefined,
      orderBy: { openedAt: 'desc' },
      take: 300,
      include: { device: { select: { id: true, name: true } } },
    });
  }

  @Get('settings')
  thresholds() {
    return this.settings.alerts();
  }

  @Patch('settings')
  @Roles('ADMIN')
  saveThresholds(@Body() dto: AlertSettingsDto) {
    return this.settings.saveAlerts(dto);
  }

  /** What is safe to show: a webhook secret or an ntfy token only says whether it is set */
  private view(channel: AlertChannel) {
    const { configEnc, ...rest } = channel;
    const config = this.crypto.decryptJson<Record<string, unknown>>(configEnc) ?? {};
    const { secret, token, ...visible } = config;
    return { ...rest, config: visible, hasSecret: !!secret || !!token };
  }

  @Get('channels')
  @Roles('ADMIN')
  async channels() {
    const rows = await this.prisma.alertChannel.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((c) => this.view(c));
  }

  private checkConfig(dto: SaveChannelDto): void {
    if (dto.type === 'email' && !dto.config.to?.length) throw new BadRequestException('Cần ít nhất một email nhận');
    if (dto.type === 'webhook' && !dto.config.url) throw new BadRequestException('Cần địa chỉ webhook');
    if (dto.type === 'ntfy' && (!dto.config.server || !dto.config.topic)) throw new BadRequestException('Cần máy chủ và topic ntfy');
  }

  @Post('channels')
  @Roles('ADMIN')
  async createChannel(@Body() dto: SaveChannelDto) {
    this.checkConfig(dto);
    const channel = await this.prisma.alertChannel.create({
      data: {
        name: dto.name.trim(),
        type: dto.type,
        configEnc: this.crypto.encryptJson(dto.config),
        events: dto.events ?? [],
        enabled: dto.enabled ?? true,
      },
    });
    return this.view(channel);
  }

  @Put('channels/:id')
  @Roles('ADMIN')
  async updateChannel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveChannelDto) {
    this.checkConfig(dto);
    const before = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Không tìm thấy kênh');
    // A secret left empty in the form keeps its value
    const old = this.crypto.decryptJson<Record<string, unknown>>(before.configEnc) ?? {};
    const config = { ...dto.config, secret: dto.config.secret || old.secret, token: dto.config.token || old.token };
    const channel = await this.prisma.alertChannel.update({
      where: { id },
      data: {
        name: dto.name.trim(),
        type: dto.type,
        configEnc: this.crypto.encryptJson(config),
        events: dto.events ?? [],
        enabled: dto.enabled ?? true,
      },
    });
    return this.view(channel);
  }

  @Delete('channels/:id')
  @Roles('ADMIN')
  async removeChannel(@Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.alertChannel.delete({ where: { id } });
    return { ok: true };
  }

  @Post('channels/:id/test')
  @HttpCode(200)
  @Roles('ADMIN')
  async testChannel(@Param('id', ParseUUIDPipe) id: string) {
    const channel = await this.prisma.alertChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Không tìm thấy kênh');
    try {
      await this.notifier.deliver(channel, {
        event: 'test',
        title: 'Thử kênh thông báo',
        message: `Kênh "${channel.name}" đang hoạt động.`,
        severity: 'info',
        at: new Date(),
      });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Gửi thử thất bại');
    }
    return { ok: true };
  }
}
