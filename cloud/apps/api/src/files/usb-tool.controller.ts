import { BadRequestException, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { rm } from 'node:fs/promises';
import { extname } from 'node:path';
import type { User } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { CurrentUser, Roles } from '../common/http';
import { SettingsService } from '../common/settings.service';
import { StorageService } from '../common/storage.service';
import { UploadsService } from './uploads.service';
import { isNewerVersion, readUsbToolPackage, UsbToolError, UsbToolManifest, UsbToolRelease } from './usb-tool';

/** What the APK page shows of it: never where it is stored */
export function usbToolView(release: UsbToolRelease | null) {
  if (!release) return null;
  const { storageKey: _stored, ...shown } = release;
  return shown;
}

@ApiTags('Công cụ cài USB')
@Controller('api/admin/usb-tool')
export class UsbToolController {
  constructor(
    private readonly uploads: UploadsService,
    private readonly storage: StorageService,
    private readonly settings: SettingsService,
    private readonly activity: ActivityService,
  ) {}

  @Get()
  async current() {
    return { release: usbToolView(await this.settings.usbTool()) };
  }

  /** Every copy of the tool takes it at its next start: an administrator's call */
  @Post('finish/:uploadId')
  @Roles('ADMIN')
  async finish(@Param('uploadId', ParseUUIDPipe) uploadId: string, @CurrentUser() actor: User) {
    const { upload, file } = await this.uploads.finish(uploadId, 'usb_tool');
    const refuse = async (message: string): Promise<never> => {
      await rm(file, { force: true });
      throw new BadRequestException(message);
    };
    if (extname(upload.fileName).toLowerCase() !== '.zip') return refuse('Chỉ nhận tệp .zip do build.ps1 của công cụ tạo ra');

    let manifest: UsbToolManifest;
    try {
      manifest = await readUsbToolPackage(file);
    } catch (error) {
      if (error instanceof UsbToolError) return refuse(error.message);
      await rm(file, { force: true });
      throw error;
    }
    const previous = await this.settings.usbTool();
    // The tool only ever moves forward: an older one would reach nobody
    if (!isNewerVersion(manifest.version, previous?.version)) {
      return refuse(`Bản ${manifest.version} không mới hơn bản đang có trên website (${previous?.version})`);
    }

    const digest = await this.storage.sha256File(file);
    const storageKey = await this.storage.adopt(file, 'tools', '.zip');
    const release: UsbToolRelease = {
      version: manifest.version,
      apkVersion: manifest.apkVersion,
      sizeBytes: Number(upload.sizeBytes),
      sha256: digest.toString('hex'),
      storageKey,
      fileName: upload.fileName,
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor.email,
    };
    await this.settings.saveUsbTool(release);
    await this.storage.remove(previous?.storageKey);
    await this.activity.log({
      action: 'usb_tool.uploaded',
      message: `${actor.email} đã tải lên công cụ cài USB bản ${release.version}${release.apkVersion ? ` (FreeKiosk ${release.apkVersion})` : ''}`,
      user: actor,
    });
    return { release: usbToolView(release) };
  }
}
