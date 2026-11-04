import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { mkdir, rm } from 'node:fs/promises';
import { extname } from 'node:path';
import type { User } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { AuthedRequest, CurrentUser, Roles } from '../common/http';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { TargetDto, targetWhere } from '../common/targets';
import { env } from '../config/env';
import { SignageService } from '../signage/signage.service';
import { ApkInspector } from './apk-inspector';
import { ApkBundle, BUNDLE_EXTENSIONS, BundleError, readApkBundle } from './apk-bundle';
import { INCOMPLETE_APK, isApkBundle, readApkManifest } from './apk-reader';
import { UploadsService } from './uploads.service';
import { installCommandData, whyCannotInstall } from '../devices/catalog';

// SVG and HTML are left out on purpose: opened in a browser, they run scripts
const MEDIA_TYPES: Record<string, { kind: 'image' | 'video'; mime: string }> = {
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.png': { kind: 'image', mime: 'image/png' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.mkv': { kind: 'video', mime: 'video/x-matroska' },
  '.mov': { kind: 'video', mime: 'video/quicktime' },
};

export class StartUploadDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(255) fileName: string;
  @ApiProperty() @IsInt() @Min(1) sizeBytes: number;
  @ApiProperty({ enum: ['media', 'apk'] }) @IsIn(['media', 'apk']) purpose: string;
}

export class FinishMediaDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
}

export class FinishApkDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class DeployApkDto {
  @ApiProperty({ type: TargetDto }) @ValidateNested() @Type(() => TargetDto) target: TargetDto;
}

export class UpdateApkDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

@ApiTags('Tải tệp lên')
@Controller('api/admin/uploads')
@Roles('ADMIN', 'OPERATOR')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post()
  async start(@Body() dto: StartUploadDto, @CurrentUser() user: User) {
    const quotaBytes = env().mediaQuotaGb * 1024 ** 3;
    if (dto.purpose === 'media' && dto.sizeBytes > quotaBytes) throw new BadRequestException('Tệp vượt quá dung lượng cho phép');
    const upload = await this.uploads.start(dto.fileName, dto.sizeBytes, dto.purpose, user.id);
    return { id: upload.id, received: 0 };
  }

  @Put(':id/part')
  part(@Param('id', ParseUUIDPipe) id: string, @Query('offset') offset: string, @Req() req: AuthedRequest) {
    const position = Number(offset);
    if (!Number.isInteger(position) || position < 0) throw new BadRequestException('offset không hợp lệ');
    if (!Buffer.isBuffer(req.body)) throw new BadRequestException('Cần gửi nội dung nhị phân');
    return this.uploads.appendPart(id, position, req.body);
  }
}

@ApiTags('Thư viện đa phương tiện')
@Controller('api/admin/media')
export class MediaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly uploads: UploadsService,
    private readonly signage: SignageService,
    private readonly activity: ActivityService,
  ) {}

  private view<T extends { id: string; fileName: string }>(asset: T) {
    return { ...asset, url: this.signage.mediaUrl(asset) };
  }

  @Get()
  async list() {
    const [assets, total] = await Promise.all([
      this.prisma.mediaAsset.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { items: true } } },
      }),
      this.prisma.mediaAsset.aggregate({ _sum: { sizeBytes: true } }),
    ]);
    return {
      assets: assets.map((a) => this.view(a)),
      usedBytes: Number(total._sum.sizeBytes ?? 0),
      quotaBytes: env().mediaQuotaGb * 1024 ** 3,
    };
  }

  @Post('finish/:uploadId')
  @Roles('ADMIN', 'OPERATOR')
  async finish(@Param('uploadId', ParseUUIDPipe) uploadId: string, @Body() dto: FinishMediaDto, @CurrentUser() actor: User) {
    const { upload, file } = await this.uploads.finish(uploadId, 'media');
    const extension = extname(upload.fileName).toLowerCase();
    const type = MEDIA_TYPES[extension];
    if (!type) throw new BadRequestException('Chỉ hỗ trợ ảnh JPG, PNG, WEBP, GIF và video MP4, WEBM, MKV, MOV');
    const used = await this.prisma.mediaAsset.aggregate({ _sum: { sizeBytes: true } });
    if (Number(used._sum.sizeBytes ?? 0) + Number(upload.sizeBytes) > env().mediaQuotaGb * 1024 ** 3) {
      throw new BadRequestException('Thư viện đã hết dung lượng');
    }
    const digest = await this.storage.sha256File(file);
    const storageKey = await this.storage.adopt(file, 'media', extension);
    const asset = await this.prisma.mediaAsset.create({
      data: {
        fileName: upload.fileName,
        title: dto.title?.trim() || upload.fileName.replace(/\.[^.]+$/, ''),
        kind: type.kind,
        mimeType: type.mime,
        sizeBytes: upload.sizeBytes,
        sha256Hex: digest.toString('hex'),
        storageKey,
      },
    });
    await this.activity.log({ action: 'media.uploaded', message: `${actor.email} đã tải lên ${upload.fileName}`, user: actor });
    return this.view(asset);
  }

  @Delete(':id')
  @Roles('ADMIN', 'OPERATOR')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
    if (!asset) throw new NotFoundException('Không tìm thấy tệp');
    if (asset._count.items > 0) throw new BadRequestException(`Tệp đang nằm trong ${asset._count.items} mục danh sách phát`);
    await this.prisma.mediaAsset.delete({ where: { id } });
    await this.storage.remove(asset.storageKey);
    await this.activity.log({ action: 'media.deleted', message: `${actor.email} đã xóa ${asset.fileName}`, user: actor });
    return { ok: true };
  }
}

@ApiTags('Phân phối APK')
@Controller('api/admin/apks')
export class ApksController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly uploads: UploadsService,
    private readonly activity: ActivityService,
    private readonly inspector: ApkInspector,
  ) {}

  @Get()
  async list() {
    const rows = await this.prisma.apkPackage.findMany({ orderBy: { createdAt: 'desc' } });
    return Promise.all(rows.map(async (apk) => ({ ...apk, incomplete: await this.inspector.isIncomplete(apk), isBundle: isApkBundle(apk) })));
  }

  @Post('finish/:uploadId')
  @Roles('ADMIN', 'OPERATOR')
  async finish(@Param('uploadId', ParseUUIDPipe) uploadId: string, @Body() dto: FinishApkDto, @CurrentUser() actor: User) {
    const { upload, file } = await this.uploads.finish(uploadId, 'apk');
    const extension = extname(upload.fileName).toLowerCase();
    const work = this.storage.tmpPath(`bundle-${uploadId}`);
    const cleanUp = async () => {
      await rm(work, { recursive: true, force: true });
      await rm(file, { force: true });
    };
    const refuse = async (message: string): Promise<never> => {
      await cleanUp();
      throw new BadRequestException(message);
    };
    if (extension !== '.apk' && !BUNDLE_EXTENSIONS.includes(extension)) return refuse('Chỉ nhận tệp .apk, .apks, .xapk, .apkm hoặc .zip');

    // A set is unpacked and checked here, so that what is wrong with it is said to the person uploading
    let bundle: ApkBundle | null = null;
    if (extension !== '.apk') {
      await mkdir(work, { recursive: true });
      try {
        bundle = await readApkBundle(file, work);
      } catch (error) {
        if (error instanceof BundleError) return refuse(error.message);
        await cleanUp();
        throw error;
      }
    }
    const final = bundle?.file ?? file;
    const manifest = bundle?.manifest ?? (await readApkManifest(file));
    if (!manifest) return refuse('Không đọc được tệp APK: tệp hỏng hoặc không phải APK');
    if (!bundle && manifest.incomplete) return refuse(INCOMPLETE_APK);

    const digest = await this.storage.sha256File(final);
    const sizeBytes = await this.storage.size(final);
    const storageKey = await this.storage.adopt(final, 'apk', bundle?.isBundle ? '.zip' : '.apk');
    await cleanUp();
    const apk = await this.prisma.apkPackage.create({
      data: {
        fileName: upload.fileName,
        storageKey,
        sizeBytes,
        sha256Hex: digest.toString('hex'),
        // URL-safe base64 with no padding: what Android expects in the provisioning QR
        checksumBase64: digest.toString('base64url'),
        packageName: manifest.packageName,
        versionName: manifest.versionName,
        versionCode: manifest.versionCode,
        notes: dto.notes,
        createdById: actor.id,
      },
    });
    await this.activity.log({ action: 'apk.uploaded', message: `${actor.email} đã tải lên ${upload.fileName} (${manifest.packageName} ${manifest.versionName ?? ''})`, user: actor });
    return apk;
  }

  @Patch(':id')
  @Roles('ADMIN', 'OPERATOR')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateApkDto) {
    return this.prisma.apkPackage.update({ where: { id }, data: { notes: dto.notes } });
  }

  /** Marks the one APK the setup wizard downloads during QR provisioning */
  @Post(':id/provisioning')
  @HttpCode(200)
  @Roles('ADMIN')
  async setProvisioning(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const apk = await this.prisma.apkPackage.findUnique({ where: { id } });
    if (!apk) throw new NotFoundException('Không tìm thấy APK');
    if (apk.packageName !== 'com.freekiosk') throw new BadRequestException('APK cấp phát phải là ứng dụng FreeKiosk (com.freekiosk)');
    if (isApkBundle(apk)) throw new BadRequestException('APK cấp phát phải là một tệp .apk đầy đủ: trình cài đặt của Android chỉ tải một tệp');
    await this.prisma.$transaction([
      this.prisma.apkPackage.updateMany({ where: { isProvisioning: true }, data: { isProvisioning: false } }),
      this.prisma.apkPackage.update({ where: { id }, data: { isProvisioning: true } }),
    ]);
    await this.activity.log({ action: 'apk.provisioning_set', message: `${actor.email} đã chọn ${apk.fileName} làm APK cấp phát`, user: actor });
    return { ok: true };
  }

  @Post(':id/deploy')
  @HttpCode(200)
  @Roles('ADMIN', 'OPERATOR')
  async deploy(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DeployApkDto, @CurrentUser() actor: User) {
    const apk = await this.prisma.apkPackage.findUnique({ where: { id } });
    if (!apk) throw new NotFoundException('Không tìm thấy APK');
    if (await this.inspector.isIncomplete(apk)) throw new BadRequestException(INCOMPLETE_APK);
    const where = targetWhere(dto.target);
    if (!where) throw new BadRequestException('Chưa chọn thiết bị');
    const devices = await this.prisma.device.findMany({ where, select: { id: true, name: true, capabilities: true } });
    const able = devices.filter((d) => !whyCannotInstall(d.capabilities, apk));
    const skipped = devices.filter((d) => !able.includes(d)).map((d) => ({ deviceId: d.id, name: d.name, reason: whyCannotInstall(d.capabilities, apk)! }));
    if (able.length) {
      await this.prisma.command.createMany({ data: able.map((d) => installCommandData(d.id, apk, actor)) });
    }
    await this.activity.log({ action: 'apk.deployed', message: `${actor.email} đã gửi ${apk.fileName} tới ${able.length} thiết bị`, user: actor });
    return { sent: able.length, skipped };
  }

  @Delete(':id')
  @Roles('ADMIN')
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: User) {
    const apk = await this.prisma.apkPackage.findUnique({ where: { id } });
    if (!apk) throw new NotFoundException('Không tìm thấy APK');
    await this.prisma.apkPackage.delete({ where: { id } });
    await this.storage.remove(apk.storageKey);
    await this.activity.log({ action: 'apk.deleted', severity: 'warning', message: `${actor.email} đã xóa ${apk.fileName}`, user: actor });
    return { ok: true };
  }
}
