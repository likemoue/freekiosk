/**
 * The APK of an app on this tablet, sent to the library of the management website (ApkExportModule.kt),
 * so that it can be installed on the others. Native: an app is tens of megabytes, sent in parts.
 */
import { NativeModules } from 'react-native';
import type { CloudCredentials } from './secureStorage';

const Native = NativeModules.ApkExport;

export interface PulledApk {
  apk_id: string;
  file_name: string;
  version_name: string;
  /** The same file was in the library already: nothing new was stored */
  already_in_library: boolean;
  size_bytes: number;
  parts: number;
}

export function canPullApk(): boolean {
  return !!Native?.upload;
}

export function pullApk(packageName: string, c: CloudCredentials, commandId: string): Promise<PulledApk> {
  if (!Native?.upload) {
    return Promise.reject(new Error('This app version cannot send apps to the website'));
  }
  return Native.upload(packageName, c.cloudUrl, c.deviceId, c.apiKey, commandId);
}
