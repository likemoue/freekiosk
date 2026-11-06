import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';
import type { User } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { CurrentUser, Roles } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../common/settings.service';
import { NO_LOCATION } from '../device-api/location';

export class LocationSettingsDto {
  @ApiProperty({ description: 'Tablet báo vị trí cho bản đồ' }) @IsBoolean() enabled: boolean;
}

/** The switch of the map. Where each tablet is comes with the device list */
@ApiTags('Bản đồ')
@Controller('api/admin/locations')
export class LocationsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly activity: ActivityService,
  ) {}

  @Get('settings')
  current() {
    return this.settings.location();
  }

  /** Switched off, the tablets stop at their next heartbeat, and the places kept are forgotten */
  @Patch('settings')
  @Roles('ADMIN')
  async save(@Body() dto: LocationSettingsDto, @CurrentUser() actor: User) {
    const before = await this.settings.location();
    const next = await this.settings.saveLocation({ enabled: dto.enabled });
    if (before.enabled !== next.enabled) {
      if (!next.enabled) await this.prisma.device.updateMany({ data: NO_LOCATION });
      await this.activity.log({
        action: next.enabled ? 'location.enabled' : 'location.disabled',
        message: next.enabled
          ? `${actor.email} đã bật thu thập vị trí thiết bị`
          : `${actor.email} đã tắt thu thập vị trí thiết bị và xóa vị trí đã lưu`,
        user: actor,
      });
    }
    return next;
  }
}
