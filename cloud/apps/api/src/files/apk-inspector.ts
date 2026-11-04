import { Injectable } from '@nestjs/common';
import { StorageService } from '../common/storage.service';
import { isApkBundle, readApkManifest } from './apk-reader';

/**
 * Whether an uploaded APK can be installed on its own. New uploads that cannot are refused, so this
 * is for those already on the server. The answer stays in memory rather than in a column: a file
 * never changes after upload, and reading a manifest takes milliseconds.
 */
@Injectable()
export class ApkInspector {
  private readonly known = new Map<string, boolean>();

  constructor(private readonly storage: StorageService) {}

  async isIncomplete(apk: { id: string; storageKey: string }): Promise<boolean> {
    // A set was checked as a whole when it was uploaded
    if (isApkBundle(apk)) return false;
    const cached = this.known.get(apk.id);
    if (cached !== undefined) return cached;
    const incomplete = (await readApkManifest(this.storage.path(apk.storageKey)))?.incomplete ?? false;
    this.known.set(apk.id, incomplete);
    return incomplete;
  }
}
