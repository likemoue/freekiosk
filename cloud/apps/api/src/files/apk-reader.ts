// adbkit-apkreader has no type declarations
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ApkReader = require('adbkit-apkreader');

export interface ApkManifest {
  packageName: string;
  versionName: string | null;
  versionCode: number | null;
  /** Only a part of an app: Android refuses to install it on its own */
  incomplete: boolean;
}

export const INCOMPLETE_APK = 'Tệp này chỉ là một phần của ứng dụng (đóng gói dạng App Bundle) nên Android không cài được. Hãy dùng bản APK đầy đủ (universal APK).';

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
    };
  } catch {
    return null;
  }
}
