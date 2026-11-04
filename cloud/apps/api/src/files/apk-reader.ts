// adbkit-apkreader has no type declarations
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ApkReader = require('adbkit-apkreader');

export interface ApkManifest {
  packageName: string;
  versionName: string | null;
  versionCode: number | null;
  /** Only a part of an app: Android refuses to install it on its own */
  incomplete: boolean;
  /** The name of this part when it is not the base APK of the app */
  splitName: string | null;
  /** What this part provides, and what a base APK requires the other parts to provide */
  splitTypes: string[];
  requiredSplitTypes: string[];
}

export const INCOMPLETE_APK = 'Tệp này chỉ là một phần của ứng dụng (đóng gói dạng App Bundle) nên Android không cài được một mình. Hãy tải lên cả bộ: tệp .apks, .xapk, .apkm, hoặc tệp .zip chứa đủ các tệp .apk.';

/** A set of APKs is stored as one zip, see apk-bundle.ts */
export const isApkBundle = (apk: { storageKey: string }) => apk.storageKey.endsWith('.zip');

/**
 * An App Bundle reaches a device as several APKs. Taken from a device or from the store, the base
 * one is a normal looking file that declares it needs the others, and installing it alone ends in
 * INSTALL_FAILED_MISSING_SPLIT. The declaration has had several forms, and bundletool may write any
 * of them. `split` is the opposite case: this file is one of the others.
 */
export function needsOtherParts(manifest: any): boolean {
  if (manifest?.split || manifest?.requiredSplitTypes) return true;
  const application = manifest?.application;
  if (application?.isSplitRequired === true) return true;
  const metaData: any[] = Array.isArray(application?.metaDatas) ? application.metaDatas : [];
  return metaData.some((item) => item?.name === 'com.android.vending.splits.required' && (item.value === true || item.value === 'true'));
}

const typesIn = (value: unknown): string[] => (typeof value === 'string' ? value.split(',').map((type) => type.trim()).filter(Boolean) : []);

/** Reads the binary AndroidManifest.xml of an APK. Null for a file that is not one */
export async function readApkManifest(file: string): Promise<ApkManifest | null> {
  try {
    const reader = await ApkReader.open(file);
    const manifest = await reader.readManifest();
    if (typeof manifest?.package !== 'string') return null;
    return {
      packageName: manifest.package,
      versionName: typeof manifest.versionName === 'string' ? manifest.versionName : null,
      versionCode: typeof manifest.versionCode === 'number' ? manifest.versionCode : null,
      incomplete: needsOtherParts(manifest),
      splitName: typeof manifest.split === 'string' && manifest.split ? manifest.split : null,
      splitTypes: typesIn(manifest.splitTypes),
      requiredSplitTypes: typesIn(manifest.requiredSplitTypes),
    };
  } catch {
    return null;
  }
}
