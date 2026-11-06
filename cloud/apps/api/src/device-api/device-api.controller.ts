import { BadRequestException, Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { diskStorage } from 'multer';
import { join } from 'node:path';
import type { Device } from '../generated/prisma/client';
import { AuthedRequest, clientIp, CurrentDevice, Public, sendStoredFile } from '../common/http';
import { rateLimit } from '../common/rate-limit';
import { env } from '../config/env';
import { SignageService } from '../signage/signage.service';
import { LiveService } from '../devices/live.service';
import { ApkPullService } from './apk-pull.service';
import { DeviceApiService } from './device-api.service';
import { DeviceGuard } from './device.guard';

const screenshotUpload = () =>
  FileInterceptor('image', {
    limits: { fileSize: 20 * 1024 * 1024 },
    storage: diskStorage({
      destination: (_req, _file, done) => done(null, join(env().dataDir, 'tmp')),
      filename: (_req, _file, done) => done(null, `screenshot-${randomUUID()}.png`),
    }),
  });

/** What the FreeKiosk app calls. The paths and the fields are the app's, not ours to change */
@ApiTags('API thiết bị')
@Controller('api/v1')
export class DeviceApiController {
  constructor(
    private readonly service: DeviceApiService,
    private readonly signage: SignageService,
    private readonly apkPull: ApkPullService,
    private readonly live: LiveService,
  ) {}

  @Public()
  @Post('devices/enroll')
  @ApiOperation({ summary: 'Đăng ký thiết bị bằng mã token dùng một lần' })
  enroll(@Body() body: Record<string, unknown>, @Req() req: AuthedRequest) {
    const ip = clientIp(req);
    rateLimit(`enroll:${ip ?? 'unknown'}`, 30, 60_000, 'Quá nhiều yêu cầu đăng ký. Thử lại sau một phút.');
    return this.service.enroll(body ?? {}, ip);
  }

  /** A screen that plays in step with others needs the time to the millisecond: nothing else happens here */
  @Public()
  @Get('time')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Giờ của máy chủ, để các màn hình phát đồng bộ' })
  time() {
    return { now: Date.now() };
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Get('devices/:deviceId/wait')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Giữ kết nối tới khi có lệnh hoặc cấu hình mới, tối đa 25 giây' })
  wait(@CurrentDevice() device: Device, @Query('hold') hold: string | undefined, @Res({ passthrough: true }) res: Response) {
    return this.service.waitForWork(device, hold, (cancel) => res.once('close', cancel));
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Post('devices/:deviceId/heartbeat')
  @HttpCode(200)
  @ApiOperation({ summary: 'Tín hiệu định kỳ 30 giây: trạng thái, cấu hình, lệnh chờ' })
  heartbeat(@CurrentDevice() device: Device, @Body() body: Record<string, unknown>, @Req() req: AuthedRequest) {
    return this.service.heartbeat(device, body ?? {}, clientIp(req));
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Post('devices/:deviceId/unenroll')
  @HttpCode(200)
  async unenroll(@CurrentDevice() device: Device, @Req() req: AuthedRequest) {
    await this.service.unenroll(device, clientIp(req));
    return { status: 'ok' };
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Get('devices/:deviceId/commands')
  commands(@CurrentDevice() device: Device) {
    return this.service.takeCommands(device);
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Get('devices/:deviceId/updates')
  updates(@CurrentDevice() device: Device) {
    return this.service.takeUpdates(device);
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Get('devices/:deviceId/app-update')
  @ApiOperation({ summary: 'Bản FreeKiosk mới nhất đã tải lên, cho nút Kiểm tra cập nhật trong ứng dụng' })
  appUpdate(@CurrentDevice() device: Device) {
    return this.service.latestAppUpdate(device);
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Post('devices/:deviceId/apps')
  @HttpCode(200)
  @ApiOperation({ summary: 'Danh sách ứng dụng mở được trên máy, gửi khi tín hiệu định kỳ yêu cầu' })
  apps(@CurrentDevice() device: Device, @Body() body: Record<string, unknown>) {
    return this.service.reportApps(device, body ?? {});
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Post('devices/:deviceId/app-icons')
  @HttpCode(200)
  @ApiOperation({ summary: 'Icon của các ứng dụng máy chủ còn thiếu' })
  appIcons(@CurrentDevice() device: Device, @Body() body: Record<string, unknown>) {
    return this.service.saveIcons(device, body ?? {});
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Post('commands/:commandId/result')
  @HttpCode(200)
  async result(
    @CurrentDevice() device: Device,
    @Param('commandId', ParseUUIDPipe) commandId: string,
    @Body() body: Record<string, unknown>,
  ) {
    await this.service.recordResult(device, commandId, body ?? {});
    return { status: 'ok' };
  }

  /** How far a long command has got, before its result: an Android update downloading, say */
  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Post('commands/:commandId/progress')
  @HttpCode(200)
  async progress(
    @CurrentDevice() device: Device,
    @Param('commandId', ParseUUIDPipe) commandId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return { status: (await this.service.recordProgress(device, commandId, body ?? {})) ? 'ok' : 'finished' };
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Post('devices/:deviceId/screenshot')
  @UseInterceptors(screenshotUpload())
  async screenshot(
    @CurrentDevice() device: Device,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body('captured_at') capturedAt: unknown,
  ) {
    await this.service.saveScreenshot(device, file, capturedAt);
    return { status: 'ok' };
  }

  /** The APK of an app on this tablet, for the library (pull_apk): started, sent in parts, finished */
  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Post('devices/:deviceId/apk-uploads')
  @HttpCode(200)
  startApkUpload(@CurrentDevice() device: Device, @Body() body: Record<string, unknown>) {
    return this.apkPull.start(device, body ?? {});
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Put('devices/:deviceId/apk-uploads/:uploadId/part')
  apkUploadPart(
    @CurrentDevice() device: Device,
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Query('offset') offset: string,
    @Req() req: AuthedRequest,
  ) {
    const position = Number(offset);
    if (!Number.isSafeInteger(position) || position < 0) throw new BadRequestException({ error: 'offset không hợp lệ' });
    return this.apkPull.part(device, uploadId, position, req.body);
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Post('devices/:deviceId/apk-uploads/:uploadId/finish')
  @HttpCode(200)
  finishApkUpload(@CurrentDevice() device: Device, @Param('uploadId', ParseUUIDPipe) uploadId: string) {
    return this.apkPull.finish(device, uploadId);
  }

  /** A picture of the screen while someone watches it on the website; the answer carries their taps */
  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Post('devices/:deviceId/live/frame')
  @HttpCode(200)
  liveFrame(
    @CurrentDevice() device: Device,
    @Query('w') width: string,
    @Query('h') height: string,
    @Query('problem') problem: string | undefined,
    @Query('control') control: string | undefined,
    @Req() req: AuthedRequest,
  ) {
    const jpeg = Buffer.isBuffer(req.body) && req.body.length > 0 ? req.body : null;
    return this.live.frame(device.id, jpeg, Number(width) || 0, Number(height) || 0, problem ? String(problem).slice(0, 300) : null, control === '1');
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Get('devices/:deviceId/playlist')
  playlist(@CurrentDevice() device: Device) {
    return this.signage.manifestFor(device.id);
  }

  @UseGuards(DeviceGuard)
  @ApiBearerAuth()
  @Get('devices/:deviceId/apk/:apkId')
  async apk(@Param('apkId', ParseUUIDPipe) apkId: string, @Res() res: Response) {
    const file = await this.service.apkFile(apkId);
    res.type('application/vnd.android.package-archive');
    sendStoredFile(res, file.path);
  }
}
