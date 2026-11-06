import { BadRequestException, Injectable } from '@nestjs/common';
import { mkdir, rm } from 'node:fs/promises';
import { extname } from 'node:path';
import type { ApkPackage } from '../generated/prisma/client';
import { PrismaService } from '../common/prisma.service';
import { StorageService } from '../common/storage.service';
import { ApkBundle, BUNDLE_EXTENSIONS, BundleError, readApkBundle } from './apk-bundle';
import { ApkManifest, INCOMPLETE_APK, readApkManifest } from './apk-reader';

export interface AddedApk {
  apk: ApkPackage;
  manifest: ApkManifest;
  /** The very same file was in the library already, and is what this answers with */
  already: boolean;
}

/**
 * What goes into the APK library, from the APK page or from a tablet (the pull_apk command): an APK, or a
 * set of them, checked so that what is wrong with it is said to whoever sent it. The temporary file is
 * gone afterwards, whatever happened.
 */
@Injectable()
export class ApkLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async add(
    file: string,
    fileName: string,
    workName: string,
    record: { createdById: string | null; notes?: string | null; reuseSameFile?: boolean },
  ): Promise<AddedApk> {
    const extension = extname(fileName).toLowerCase();
    const work = this.storage.tmpPath(`bundle-${workName}`);
    const cleanUp = async () => {
      await rm(work, { recursive: true, force: true });
      await rm(file, { force: true });
    };
    const refuse = async (message: string): Promise<never> => {
      await cleanUp();
      throw new BadRequestException(message);
    };
    if (extension !== '.apk' && !BUNDLE_EXTENSIONS.includes(extension)) return refuse('Chỉ nhận tệp .apk, .apks, .xapk, .apkm hoặc .zip');

    // A set is unpacked and checked here, so that what is wrong with it is said to whoever sent it
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
    if (record.reuseSameFile) {
      const same = await this.prisma.apkPackage.findFirst({ where: { sha256Hex: digest.toString('hex') } });
      if (same) {
        await cleanUp();
        if (final !== file) await rm(final, { force: true });
        return { apk: same, manifest, already: true };
      }
    }
    const sizeBytes = await this.storage.size(final);
    const storageKey = await this.storage.adopt(final, 'apk', bundle?.isBundle ? '.zip' : '.apk');
    await cleanUp();
    const apk = await this.prisma.apkPackage.create({
      data: {
        fileName,
        storageKey,
        sizeBytes,
        sha256Hex: digest.toString('hex'),
        // URL-safe base64 with no padding: what Android expects in the provisioning QR
        checksumBase64: digest.toString('base64url'),
        packageName: manifest.packageName,
        versionName: manifest.versionName,
        versionCode: manifest.versionCode,
        notes: record.notes ?? undefined,
        createdById: record.createdById,
      },
    });
    return { apk, manifest, already: false };
  }
}
