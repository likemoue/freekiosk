import { Body, Controller, Get, HttpCode, NotFoundException, Param, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { User } from '../generated/prisma/client';
import { CurrentUser, Roles } from '../common/http';
import { ApplyHomeAppsDto, HomeAppsPreviewDto } from './devices.dto';
import { PACKAGE_NAME } from './home-apps';
import { HomeAppsService } from './home-apps.service';

/** The apps on the home screen of the tablets, chosen by name and icon rather than by package */
@ApiTags('Ứng dụng trên màn hình')
@Controller('api/admin/home-apps')
export class HomeAppsController {
  constructor(private readonly homeApps: HomeAppsService) {}

  @Post('preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Các ứng dụng có thể chọn cho một thiết bị, một nhóm hoặc toàn bộ, và số máy đang hiện từng ứng dụng' })
  preview(@Body() dto: HomeAppsPreviewDto) {
    return this.homeApps.preview(dto.target);
  }

  @Post('apply')
  @HttpCode(200)
  @Roles('ADMIN', 'OPERATOR')
  @ApiOperation({ summary: 'Thêm hoặc gỡ ứng dụng trên màn hình chính, tính riêng cho từng máy' })
  apply(@Body() dto: ApplyHomeAppsDto, @CurrentUser() actor: User) {
    return this.homeApps.apply(dto.target, dto.add ?? [], dto.remove ?? [], dto.switchToMulti === true, actor);
  }

  @Get('icons/:packageName')
  async icon(@Param('packageName') packageName: string, @Res() res: Response) {
    const icon = PACKAGE_NAME.test(packageName) ? await this.homeApps.icon(packageName) : null;
    if (!icon) throw new NotFoundException();
    // The address carries the version of the icon, so a new one is a new address
    res.setHeader('Cache-Control', 'private, max-age=604800');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('image/png').send(icon);
  }
}
