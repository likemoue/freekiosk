/**
 * Tells the management website which apps this tablet can open, so that the website can offer them
 * by name and icon instead of by package name.
 *
 * The heartbeat carries only a hash. The website asks for the list when the hash is new, and for
 * the icons it does not have yet, so that a fleet of tablets with the same apps sends each icon
 * once. Nothing is remembered here: a round cut short is asked for again at the next heartbeat.
 */
import AppLauncherModule from './AppLauncherModule';
import type { CloudCredentials } from './secureStorage';

const OWN_PACKAGE = 'com.freekiosk';
// Reading the package list is not free, and nothing changes it every 30 seconds
const SCAN_EVERY_MS = 5 * 60_000;
const ICON_SIZE = 96;
const REQUEST_TIMEOUT_MS = 30_000;
// The server asks for a few at a time and stops when it has them: this only guards against a bad one
const MAX_ICON_ROUNDS = 150;

export interface ReportedApp {
  package: string;
  label: string;
  version_code: number;
  version_name?: string;
}

let scan: { at: number; hash: string; apps: ReportedApp[] } | null = null;
let answering = false;

/* eslint-disable no-bitwise */
/** Not for security: only tells whether the list changed since the website last saw it */
function hashOf(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}
/* eslint-enable no-bitwise */

async function refresh(): Promise<void> {
  const installed = await AppLauncherModule.getInstalledApps();
  if (!Array.isArray(installed)) return;
  const apps = installed
    .filter((app) => app.packageName !== OWN_PACKAGE)
    .map((app) => ({
      package: app.packageName,
      label: app.appName,
      version_code: app.versionCode ?? 0,
      ...(app.versionName ? { version_name: app.versionName } : {}),
    }))
    .sort((a, b) => a.package.localeCompare(b.package));
  scan = { at: Date.now(), hash: hashOf(JSON.stringify(apps)), apps };
}

async function post(c: CloudCredentials, path: string, body: unknown): Promise<{ icons_wanted?: string[] } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${c.cloudUrl}/api/v1/devices/${c.deviceId}/${path}/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return response.ok ? await response.json() : null;
  } finally {
    clearTimeout(timer);
  }
}

/** The icon as the base64 of a PNG, or null to say this tablet cannot give it */
async function readIcon(packageName: string): Promise<{ package: string; png_base64: string | null }> {
  try {
    const uri = await AppLauncherModule.getAppIcon(packageName, ICON_SIZE);
    return { package: packageName, png_base64: typeof uri === 'string' ? uri.replace(/^data:image\/png;base64,/, '') : null };
  } catch {
    return { package: packageName, png_base64: null };
  }
}

export const InstalledAppsReport = {
  /** For the heartbeat. Undefined when the list cannot be read: the website then asks for nothing */
  async hash(): Promise<string | undefined> {
    if (!scan || Date.now() - scan.at >= SCAN_EVERY_MS) {
      await refresh().catch(() => {});
    }
    return scan?.hash;
  },

  /** What a heartbeat answer asked for. Never in the way of the heartbeat, which does not wait */
  async answer(c: CloudCredentials, listWanted: unknown, iconsWanted: unknown): Promise<void> {
    let wanted: string[] = Array.isArray(iconsWanted) ? iconsWanted : [];
    if (answering || (listWanted !== true && !wanted.length)) return;
    answering = true;
    try {
      if (listWanted === true && scan) {
        const answer = await post(c, 'apps', { hash: scan.hash, apps: scan.apps });
        wanted = answer?.icons_wanted ?? [];
      }
      for (let round = 0; wanted.length && round < MAX_ICON_ROUNDS; round++) {
        const icons = await Promise.all(wanted.map(readIcon));
        const answer = await post(c, 'app-icons', { icons });
        wanted = answer?.icons_wanted ?? [];
      }
    } finally {
      answering = false;
    }
  },

  /** Tests only: the next heartbeat reads the list again */
  reset(): void {
    scan = null;
    answering = false;
  },
};
