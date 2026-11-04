/**
 * Where "Check for updates" in Settings > Advanced looks.
 *
 * An enrolled tablet asks the server it is enrolled on for the newest FreeKiosk uploaded there, and
 * installs it the way the server's own push does (ManagedAppInstaller). A tablet that is not
 * enrolled, or whose server has no such route (the hosted FreeKiosk Cloud), asks GitHub.
 */
import ManagedAppInstaller from './ManagedAppInstaller';
import { getCloudCredentials } from './secureStorage';
import UpdateModule from './UpdateModule';

const OWN_PACKAGE = 'com.freekiosk';
const CHECK_TIMEOUT_MS = 15_000;

export interface AppUpdate {
  version: string;
  name?: string;
  notes?: string;
  publishedAt?: string;
  downloadUrl: string;
  isPrerelease?: boolean;
  /** Set when it comes from the management server, which compares by version code */
  versionCode?: number;
  fromServer?: boolean;
}

/** The newest version on offer, or null when the server has none. */
export async function findLatestUpdate(includeBeta: boolean): Promise<AppUpdate | null> {
  const credentials = await getCloudCredentials();
  if (credentials) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
    try {
      const response = await fetch(
        `${credentials.cloudUrl}/api/v1/devices/${credentials.deviceId}/app-update/`,
        { headers: { Authorization: `Bearer ${credentials.apiKey}` }, signal: controller.signal },
      );
      if (response.ok) {
        const { update } = await response.json();
        if (!update) return null;
        return {
          version: update.version,
          notes: update.notes ?? '',
          publishedAt: update.published_at,
          downloadUrl: update.download_url,
          // Every version of a build that is not a release has a suffix (2.1.0-beta.3)
          isPrerelease: String(update.version).includes('-'),
          versionCode: update.version_code,
          fromServer: true,
        };
      }
      if (response.status !== 404) {
        throw new Error(`HTTP ${response.status}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return UpdateModule.checkForUpdatesWithChannel(includeBeta);
}

/**
 * Downloads and installs a version from the management server. Only a Device Owner can (the promise
 * rejects with NOT_DEVICE_OWNER otherwise), and Android replaces this process during the install,
 * so on success the app comes back by itself and the promise may never settle.
 */
export async function installFromServer(update: AppUpdate): Promise<void> {
  const credentials = await getCloudCredentials();
  if (!credentials) {
    throw new Error('Not enrolled');
  }
  await ManagedAppInstaller.installFromUrl(update.downloadUrl, credentials.apiKey, OWN_PACKAGE);
}
