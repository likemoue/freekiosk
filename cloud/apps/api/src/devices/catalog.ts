import type { ApkPackage, User } from '../generated/prisma/client';
import { Prisma } from '../generated/prisma/client';
import { isApkBundle } from '../files/apk-reader';

/**
 * The commands the app understands (src/utils/CloudCommandService.ts) and what each one needs.
 * `capability` matches src/utils/capabilities.ts: a device that reports capabilities and lacks
 * this one is skipped instead of being sent a command that cannot run. A device reporting an
 * empty list is an older app: everything stays available for it.
 */
export interface CommandSpec {
  capability?: string;
  adminOnly?: boolean;
  /** Parameters kept encrypted until delivery, and never shown back */
  secretParams?: string[];
  validate?: (params: Record<string, unknown>) => string | null;
}

const text = (name: string, label: string, max = 2000) => (params: Record<string, unknown>) => {
  const value = params[name];
  if (typeof value !== 'string' || !value.trim()) return `Cần nhập ${label}`;
  if (value.length > max) return `${label} quá dài`;
  return null;
};

const httpUrl = (name: string) => (params: Record<string, unknown>) => {
  const value = params[name];
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value) ? null : 'URL phải bắt đầu bằng http:// hoặc https://';
};

export const COMMANDS: Record<string, CommandSpec> = {
  screen_on: { capability: 'screen' },
  screen_off: { capability: 'screen' },
  wake: { capability: 'screen' },
  reload: { capability: 'reload' },
  screensaver_on: {},
  screensaver_off: {},
  speak: { capability: 'tts', validate: text('text', 'nội dung cần đọc') },
  play_sound: { capability: 'audio', validate: httpUrl('url') },
  audio_stop: { capability: 'audio' },
  reboot: { capability: 'reboot' },
  clear_cache: {},
  toast: { capability: 'toast', validate: text('message', 'nội dung thông báo', 500) },
  // Runs code in the page shown on the kiosk: the most powerful command, and the most dangerous
  execute_js: { adminOnly: true, validate: text('code', 'mã JavaScript', 20_000) },
  launch_app: { validate: text('package_name', 'tên gói ứng dụng', 200) },
  screenshot: { capability: 'screenshot' },
  add_wifi_network: {
    adminOnly: true,
    secretParams: ['password'],
    validate: text('ssid', 'tên mạng Wi-Fi', 64),
  },
};

/** Not a command the tablet runs: a change of its apps through the configuration, kept for the history */
export const HOME_APPS_COMMAND = 'home_apps';

export const COMMAND_LABELS: Record<string, string> = {
  [HOME_APPS_COMMAND]: 'Ứng dụng trên màn hình',
  screen_on: 'Bật màn hình',
  screen_off: 'Tắt màn hình',
  wake: 'Đánh thức',
  reload: 'Tải lại',
  screensaver_on: 'Bật bảo vệ màn hình',
  screensaver_off: 'Tắt bảo vệ màn hình',
  speak: 'Đọc văn bản',
  play_sound: 'Phát âm thanh',
  audio_stop: 'Dừng âm thanh',
  reboot: 'Khởi động lại',
  clear_cache: 'Xóa bộ nhớ đệm',
  toast: 'Hiện thông báo',
  execute_js: 'Chạy JavaScript',
  launch_app: 'Mở ứng dụng',
  screenshot: 'Chụp màn hình',
  add_wifi_network: 'Thêm mạng Wi-Fi',
  install_apk: 'Cài APK',
};

/**
 * Why this tablet cannot take this upload, or null if it can. Installing with no prompt takes
 * Device Owner, and a set of APKs takes a version of the app that knows how. An empty list of
 * capabilities is an older app, which may be Device Owner but cannot install a set.
 */
export function whyCannotInstall(capabilities: string[], apk: { storageKey: string }): string | null {
  if (capabilities.length > 0 && !capabilities.includes('silent_install')) return 'Thiết bị không ở chế độ Device Owner nên không cài tự động được';
  if (isApkBundle(apk) && !capabilities.includes('split_install')) return 'Cần cài FreeKiosk bản mới nhất để cài bộ nhiều tệp';
  return null;
}

/**
 * A silent install of an uploaded APK, delivered through GET updates. It lives for a week rather
 * than an hour: a tablet switched off for the weekend still gets it.
 */
export function installCommandData(deviceId: string, apk: ApkPackage, actor: User, extra: Record<string, unknown> = {}, batchId?: string): Prisma.CommandCreateManyInput {
  return {
    deviceId,
    type: 'install_apk',
    params: { apk_id: apk.id, package_name: apk.packageName, file_name: apk.fileName, version: apk.versionName, ...extra } as Prisma.InputJsonValue,
    batchId,
    createdById: actor.id,
    createdBy: actor.email,
    expiresAt: new Date(Date.now() + 7 * 86_400_000),
  };
}
