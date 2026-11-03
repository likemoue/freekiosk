// adbkit-apkreader has no type declarations
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ApkReader = require('adbkit-apkreader');

export interface ApkManifest {
  packageName: string;
  versionName: string | null;
  versionCode: number | null;
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
    };
  } catch {
    return null;
  }
}
