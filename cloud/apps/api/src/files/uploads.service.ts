import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { appendFile, rm } from 'node:fs/promises';
import type { Upload } from '../generated/prisma/client';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';

const MAX_SIZE = 8 * 1024 * 1024 * 1024;
const STALE_MS = 24 * 3_600_000;

/**
 * Uploads in parts. Cloudflare refuses a request over 100 MB on its usual plans, whatever the
 * proxies behind it allow, and a video or an APK can be larger: the page sends a large file
 * as a series of small requests, and a part that fails can simply be sent again.
 */
@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async start(fileName: string, sizeBytes: number, purpose: string, userId: string | null, from?: { deviceId: string; commandId: string }): Promise<Upload> {
    if (sizeBytes <= 0 || sizeBytes > MAX_SIZE) throw new BadRequestException('Kích thước tệp không hợp lệ');
    return this.prisma.upload.create({ data: { fileName, sizeBytes, purpose, createdById: userId, deviceId: from?.deviceId, commandId: from?.commandId } });
  }

  /** A tablet's own upload, refused to any other tablet */
  async ofDevice(id: string, deviceId: string): Promise<Upload> {
    const upload = await this.prisma.upload.findUnique({ where: { id } });
    if (!upload || upload.deviceId !== deviceId) throw new NotFoundException('Không tìm thấy phiên tải lên');
    return upload;
  }

  private tmp(id: string): string {
    return this.storage.tmpPath(`upload-${id}`);
  }

  /** `offset` says where this part goes: a repeated part, or one out of order, is refused with the real position */
  async appendPart(id: string, offset: number, part: Buffer): Promise<{ received: number }> {
    const upload = await this.prisma.upload.findUnique({ where: { id } });
    if (!upload || upload.completedAt) throw new NotFoundException('Không tìm thấy phiên tải lên');
    const received = await this.storage.size(this.tmp(id));
    if (offset !== received) return { received };
    if (received + part.length > Number(upload.sizeBytes)) throw new BadRequestException('Dữ liệu vượt quá kích thước đã khai báo');
    await appendFile(this.tmp(id), part);
    const next = received + part.length;
    await this.prisma.upload.update({ where: { id }, data: { receivedBytes: next } });
    return { received: next };
  }

  /** Hands over the finished temporary file: the caller moves it where it belongs */
  async finish(id: string, purpose: string): Promise<{ upload: Upload; file: string }> {
    const upload = await this.prisma.upload.findUnique({ where: { id } });
    if (!upload || upload.completedAt || upload.purpose !== purpose) throw new NotFoundException('Không tìm thấy phiên tải lên');
    const received = await this.storage.size(this.tmp(id));
    if (received !== Number(upload.sizeBytes)) {
      throw new BadRequestException(`Tệp chưa tải lên đủ (${received}/${upload.sizeBytes} byte)`);
    }
    await this.prisma.upload.update({ where: { id }, data: { completedAt: new Date() } });
    return { upload, file: this.tmp(id) };
  }

  @Interval(3_600_000)
  async clean(): Promise<void> {
    const stale = await this.prisma.upload.findMany({ where: { createdAt: { lt: new Date(Date.now() - STALE_MS) } } });
    for (const upload of stale) await rm(this.tmp(upload.id), { force: true }).catch(() => {});
    if (stale.length) await this.prisma.upload.deleteMany({ where: { id: { in: stale.map((u) => u.id) } } });
  }
}
