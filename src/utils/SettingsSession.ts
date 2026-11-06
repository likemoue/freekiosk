/**
 * The time someone spends in Settings after typing the PIN.
 *
 * Settings checks the PIN only when it opens, and used to stay open behind whatever came over it. On an
 * SM-X210 it was left open, the website opened iCLASS over it, then sent Bật màn hình: FreeKiosk came back
 * to the front still showing Settings, to whoever stood there, with no PIN asked.
 *
 * So the session ends whenever FreeKiosk hands the screen to something else, since whoever comes back to it
 * may not be the person who typed the PIN: a command that changes what is on screen (from the website or the
 * local API), the screen turning off, or five minutes with nobody touching Settings. Settings answers by
 * going back to the kiosk screen, and the PIN is asked again. Leaving for an Android settings page from
 * Settings itself does not end it: the admin comes back to where they were.
 */
import { revokeSettingsAccess } from './authState';

type Listener = (reason: string) => void;

const listeners = new Set<Listener>();

/** Five minutes untouched: the kiosk keeps its screen on, so nothing else would ever close Settings */
export const SETTINGS_IDLE_MS = 5 * 60_000;

/** Commands from the website after which Settings must not still be behind the screen */
export const COMMANDS_ENDING_SETTINGS = new Set([
  'launch_app',
  'stop_apps',
  'screen_on',
  'screen_off',
  'wake',
  'reboot',
  'clear_app_data',
  'uninstall_app',
]);

export const SettingsSession = {
  /** Settings listens while it is open */
  onEnd(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  isOpen(): boolean {
    return listeners.size > 0;
  },

  end(reason: string): void {
    revokeSettingsAccess();
    for (const listener of [...listeners]) {
      try {
        listener(reason);
      } catch (error) {
        console.warn('[SettingsSession] A listener failed:', error);
      }
    }
  },
};
