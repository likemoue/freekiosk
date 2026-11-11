import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Device } from '../generated/prisma/client';
import { ActivityService } from '../common/activity.service';
import { PrismaService } from '../common/prisma.service';
import { ApkLibraryService } from '../files/apk-library.service';
import { UploadsService } from '../files/uploads.service';

/**
 * Parts small enough to pass Cloudflare on a slow link: it answers 524 for a request that has had no answer
 * in 100 seconds. Two Lenovo tablets sent Chrome at about 180 KB/s (their side of the school's two lines,
 * 11 November), so a 16 MB part took 90 seconds and one went over; 4 MB takes 23. The app takes this size
 * from the answer, from 1 to 32 MB, so an app already out there follows it.
 */
export const DEVICE_PART_BYTES = 4 * 1024 * 1024;
/** What a tablet may still send: the app's own upper bound, for an upload started under the old size */
const MAX_DEVICE_PART_BYTES = 32 * 1024 * 1024;
const PURPOSE = 'device_apk';

type Json = Record<string, unknown>;
const obj = (value: unknown): Json => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {});

/**
 * A tablet sending the APK of one of its apps to the library (the pull_apk command, ApkExportModule.kt in
 * the app), in parts like an upload from the APK page, and checked the same way. Only for a command sent
 * to this tablet and still waiting for its answer.
 */
@Injectable()
export class ApkPullService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly uploads: UploadsService,
    private readonly library: ApkLibraryService,
    private readonly activity: ActivityService,
  ) {}

  async start(device: Device, body: Json) {
    const commandId = typeof body.command_id === 'string' ? body.command_id : '';
    const sizeBytes = Number(body.size_bytes);
    const fileName = typeof body.file_name === 'string' ? body.file_name : '';
    const command = commandId ? await this.prisma.command.findFirst({ where: { id: commandId, deviceId: device.id, type: 'pull_apk' } }) : null;
    if (!command || command.status !== 'SENT') throw new NotFoundException({ error: 'Không có lệnh lấy APK nào đang chờ tệp này' });
    if (!/\.(apk|zip)$/i.test(fileName)) throw new BadRequestException({ error: 'Chỉ nhận tệp .apk hoặc .zip' });
    if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw new BadRequestException({ error: 'Kích thước tệp không hợp lệ' });
    const upload = await this.uploads.start(fileName, sizeBytes, PURPOSE, null, { deviceId: device.id, commandId: command.id });
    return { upload_id: upload.id, part_bytes: DEVICE_PART_BYTES };
  }

  async part(device: Device, uploadId: string, offset: number, part: unknown) {
    await this.uploads.ofDevice(uploadId, device.id);
    if (!Buffer.isBuffer(part) || part.length === 0) throw new BadRequestException({ error: 'Cần gửi nội dung nhị phân' });
    if (part.length > MAX_DEVICE_PART_BYTES) throw new BadRequestException({ error: 'Phần gửi lên quá lớn' });
    return this.uploads.appendPart(uploadId, offset, part);
  }

  async finish(device: Device, uploadId: string) {
    const mine = await this.uploads.ofDevice(uploadId, device.id);
    const command = mine.commandId ? await this.prisma.command.findUnique({ where: { id: mine.commandId } }) : null;
    if (!command) throw new NotFoundException({ error: 'Lệnh lấy APK không còn' });
    const label = typeof obj(command.params).label === 'string' ? String(obj(command.params).label) : '';
    const { upload, file } = await this.uploads.finish(uploadId, PURPOSE);
    const extension = upload.fileName.toLowerCase().endsWith('.zip') ? '.zip' : '.apk';

    // Named for a person reading the library: the app and where it came from, as the tablet calls it
    const { apk, manifest, already } = await this.library.add(file, `pull-${uploadId}${extension}`, uploadId, {
      createdById: command.createdById,
      notes: `Lấy từ ${device.name}`,
      reuseSameFile: true,
    });
    if (!already) {
      const name = `${label || manifest.packageName} ${manifest.versionName ?? ''}`.trim().replace(/[\\/:*?"<>|]+/g, '-');
      await this.prisma.apkPackage.update({ where: { id: apk.id }, data: { fileName: `${name}${extension}` } });
      apk.fileName = `${name}${extension}`;
    }
    await this.activity.log({
      action: 'apk.pulled',
      message: already
        ? `${device.name} đã gửi ${apk.fileName}, đã có sẵn trong thư viện`
        : `${device.name} đã gửi ${apk.fileName} (${manifest.packageName} ${manifest.versionName ?? ''}) lên thư viện APK`,
      device,
      data: { apkId: apk.id, commandId: command.id, by: command.createdBy },
    });
    return {
      apk_id: apk.id,
      file_name: apk.fileName,
      version_name: apk.versionName,
      package_name: apk.packageName,
      already_in_library: already,
    };
  }
}
