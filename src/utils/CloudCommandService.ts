/**
 * CloudCommandService.ts
 * Consumes the FreeKiosk Cloud command queue and the dedicated APK update
 * channel, dispatches actions through ApiService.executeAction (the same path
 * as the local REST/MQTT server), and reports each result back to the server.
 *
 * Channels:
 *   - GET  /api/v1/devices/{id}/commands/  → transient actions (mark 'sent' server-side)
 *   - GET  /api/v1/devices/{id}/updates/   → install_apk (resolves signed download URL)
 *   - POST /api/v1/commands/{id}/result/   → report success/error
 *
 * Triggered as soon as the website queues something (CloudWake.kt), and from
 * CloudSyncService on each heartbeat when pending_commands > 0. Behind another app
 * this runs through the headless task, since React Native stops JS timers there.
 *
 * The two channels run side by side: an APK can take minutes to download, and a
 * command sent in the meantime should not wait for it.
 */
import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';

import { ApiService, ActionResult } from './ApiService';
import { getCloudCredentials, CloudCredentials } from './secureStorage';
import { StorageService } from './storage';
import ManagedAppInstaller from './ManagedAppInstaller';
import KioskModule from './KioskModule';
import { locateNow } from './DeviceLocation';

const { HttpServerModule, WifiControlModule } = NativeModules;

/** Our own package, so a self-update is recognised as a process-killing command. */
const OWN_PACKAGE = 'com.freekiosk';

/** Give up on a result the server never accepted rather than retry it forever. */
const MAX_REPORT_ATTEMPTS = 10;

// Declared as type aliases, not interfaces, so they stay assignable to the
// Record<string, unknown> the storage layer persists.
type PendingReport = {
  commandId: string;
  status: 'success' | 'error';
  result: Record<string, unknown> | null;
  errorMessage: string;
  attempts: number;
};

/** A command persisted before dispatch, so it survives the process dying mid-execution. */
type InflightCommand = {
  commandId: string;
  type: string;
  /** True when the process is expected to die (reboot, self-update): that is the success case. */
  killsProcess: boolean;
};

interface CloudCommand {
  id: string;
  type: string;
  params: Record<string, any>;
  created_at: string;
  expires_at: string;
}

interface CloudUpdate {
  command_id: string;
  package_name: string | null;
  version_name: string | null;
  download_url: string;
}

type CommandMapper = (params: Record<string, any>) => {
  command: string;
  params: Record<string, any>;
};

/**
 * Maps a cloud CommandType (snake_case) to the local action name + param shape
 * understood by ApiService.executeAction. URL / brightness / volume are NOT here:
 * those are managed settings delivered through the config-sync channel, not
 * transient commands. install_apk is handled via the /updates/ channel, not here.
 */
const COMMAND_MAP: Record<string, CommandMapper> = {
  screen_on: () => ({ command: 'screenOn', params: {} }),
  screen_off: () => ({ command: 'screenOff', params: {} }),
  reload: () => ({ command: 'reload', params: {} }),
  screensaver_on: () => ({ command: 'screensaverOn', params: {} }),
  screensaver_off: () => ({ command: 'screensaverOff', params: {} }),
  wake: () => ({ command: 'wake', params: {} }),
  speak: (p) => ({ command: 'tts', params: { text: p.text } }),
  play_sound: (p) => ({ command: 'playSound', params: { url: p.url } }),
  audio_stop: () => ({ command: 'audioStop', params: {} }),
  reboot: () => ({ command: 'reboot', params: {} }),
  clear_cache: () => ({ command: 'clearCache', params: {} }),
  toast: (p) => ({ command: 'toast', params: { text: p.message } }),
  execute_js: (p) => ({ command: 'executeJs', params: { code: p.code } }),
  launch_app: (p) => ({ command: 'launchApp', params: { package: p.package_name } }),
  // NOTE: `screenshot` is handled separately (capture + upload), not via this map.
};

type Channel = 'commands' | 'updates';

class CloudCommandServiceClass {
  private running: Record<Channel, boolean> = { commands: false, updates: false };
  // A word that came while the channel was busy: it looks again when done
  private lookAgain: Record<Channel, boolean> = { commands: false, updates: false };
  // Guards against re-dispatching the same command if two polls overlap. The
  // server already only returns 'pending' commands, so this is belt-and-braces.
  private processed = new Set<string>();
  // What this very process is running: its marker on disk is not left over from a previous run
  private underWay = new Set<string>();

  /**
   * Fetch + execute any pending commands and APK updates. Safe to call at any time: a channel
   * already at work looks again when it is done.
   */
  async poll(creds?: CloudCredentials): Promise<void> {
    const c = creds ?? (await getCloudCredentials());
    if (!c) return;
    // Only with nothing under way: what is in flight now would read as left over from a previous run
    if (!this.running.commands && !this.running.updates) await this.settleOutstanding(c);
    await Promise.all([this.pollChannel('updates', c), this.pollChannel('commands', c)]);
    // Keep the dedup set from growing unbounded.
    if (!this.running.commands && !this.running.updates && this.processed.size > 200) this.processed.clear();
  }

  private async pollChannel(channel: Channel, c: CloudCredentials): Promise<void> {
    if (this.running[channel]) {
      this.lookAgain[channel] = true;
      return;
    }
    this.running[channel] = true;
    try {
      do {
        this.lookAgain[channel] = false;
        await (channel === 'updates' ? this.pollUpdates(c) : this.pollCommands(c));
      } while (this.lookAgain[channel]);
    } catch (error) {
      console.error('[CloudCommand] Poll error:', error);
    } finally {
      this.running[channel] = false;
    }
  }

  // ─── Generic command queue ───────────────────────────────────────────────────

  private async pollCommands(c: CloudCredentials): Promise<void> {
    const res = await fetch(`${c.cloudUrl}/api/v1/devices/${c.deviceId}/commands/`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${c.apiKey}` },
    });
    if (!res.ok) return;

    const data = await res.json();
    const commands: CloudCommand[] = data?.commands ?? [];

    for (const cmd of commands) {
      if (this.processed.has(cmd.id)) continue;
      this.processed.add(cmd.id);

      // The server only hands over what has not expired, by its own clock. This tablet's may be
      // hours off, and going by it dropped commands with no word to the server.

      // Persist before dispatch: `reboot` takes the device down and a self-update
      // replaces this very process, so without a marker on disk their result could
      // never be reported and the command stayed 'sent' on the server for good.
      this.underWay.add(cmd.id);
      try {
        await StorageService.saveInflightCommand({
          commandId: cmd.id,
          type: cmd.type,
          killsProcess: cmd.type === 'reboot',
        } satisfies InflightCommand);

        const outcome = await this.runCommand(cmd, c);
        await StorageService.saveInflightCommand(null);
        await this.reportResult(c, cmd.id, outcome);
      } finally {
        this.underWay.delete(cmd.id);
      }
    }
  }

  /**
   * Finish anything a previous run could not: a command interrupted by a restart,
   * then results the network refused. Called on every poll and once at startup.
   *
   * The startup call is the one that matters for an interrupted command: the server
   * moved it to 'sent' when it handed it over, so it no longer counts as pending and
   * a heartbeat alone would never trigger a poll to pick the marker back up.
   */
  async settleOutstanding(creds?: CloudCredentials): Promise<void> {
    const c = creds ?? (await getCloudCredentials());
    if (!c) return;
    try {
      await this.reportInflightCommand(c);
      await this.flushPendingReports(c);
    } catch (error) {
      console.error('[CloudCommand] Settle error:', error);
    }
  }

  /**
   * Report a command that was still in flight when the process died. A command
   * expected to kill the process (reboot, self-update) reached its goal, so it is
   * reported as a success; anything else was interrupted and says so honestly.
   *
   * Only for one no longer running: this also happens when the kiosk screen comes back, from Settings
   * say, in the same process, and an install under way then was called interrupted and went on to finish.
   */
  private async reportInflightCommand(c: CloudCredentials): Promise<void> {
    const install = (await StorageService.getInflightInstall()) as InflightCommand | null;
    if (install && !this.underWay.has(install.commandId)) {
      await StorageService.saveInflightInstall(null);
      await this.reportInterrupted(c, install);
    }

    const command = (await StorageService.getInflightCommand()) as InflightCommand | null;
    if (command && !this.underWay.has(command.commandId)) {
      await StorageService.saveInflightCommand(null);
      await this.reportInterrupted(c, command);
    }
  }

  private async reportInterrupted(c: CloudCredentials, inflight: InflightCommand | null): Promise<void> {
    if (!inflight?.commandId) return;
    this.processed.add(inflight.commandId);

    await this.reportResult(
      c,
      inflight.commandId,
      inflight.killsProcess
        ? { ok: true, result: { restarted: true } }
        : { ok: false, error: 'Device restarted before the command result could be reported' },
    );
  }

  /** Retry results the network refused earlier. Dropped after MAX_REPORT_ATTEMPTS. */
  private async flushPendingReports(c: CloudCredentials): Promise<void> {
    const queue = (await StorageService.getPendingReports()) as PendingReport[];
    if (queue.length === 0) return;

    const stillPending: PendingReport[] = [];
    for (const report of queue) {
      const sent = await this.postResult(c, report);
      if (!sent && report.attempts + 1 < MAX_REPORT_ATTEMPTS) {
        stillPending.push({ ...report, attempts: report.attempts + 1 });
      }
    }
    await StorageService.savePendingReports(stillPending);
  }

  private async enqueueReport(report: PendingReport): Promise<void> {
    const queue = (await StorageService.getPendingReports()) as PendingReport[];
    // Guard against the same result piling up if a poll overlaps a retry.
    const deduped = queue.filter(r => r.commandId !== report.commandId);
    deduped.push(report);
    await StorageService.savePendingReports(deduped);
  }

  private async runCommand(cmd: CloudCommand, c: CloudCredentials): Promise<ActionResult> {
    // Screenshot needs a capture + upload round-trip, not a fire-and-forget action.
    if (cmd.type === 'screenshot') {
      return this.captureAndUploadScreenshot(c);
    }
    // Handled here rather than through COMMAND_MAP on purpose: that map feeds the
    // shared action layer the local REST API and MQTT also drive, and a way to plant a
    // Wi-Fi network on the tablet has no business being reachable from the LAN.
    if (cmd.type === 'add_wifi_network') {
      return this.saveWifiNetwork(cmd.params || {});
    }
    // Here too, for the same reason: nobody on the LAN should be able to close what is on the screen.
    if (cmd.type === 'stop_apps') {
      return this.stopRunningApps();
    }
    if (cmd.type === 'clear_app_data') {
      return this.clearAppData(cmd.params || {});
    }
    if (cmd.type === 'set_screen_timeout') {
      return this.setScreenTimeout(cmd.params || {});
    }
    // Where the tablet is, for the website alone: not for the LAN either
    if (cmd.type === 'locate') {
      return this.locate();
    }
    // Straight to Android: the action layer goes through the kiosk screen, which may not be there
    if (cmd.type === 'set_volume') {
      return this.setVolume(cmd.params || {});
    }

    // Own keys only: "constructor" is a key of every object, and it would run whatever was in the params
    const mapper = Object.prototype.hasOwnProperty.call(COMMAND_MAP, cmd.type) ? COMMAND_MAP[cmd.type] : undefined;
    if (!mapper) {
      return { ok: false, error: `Unsupported command type: ${cmd.type}` };
    }
    try {
      const { command, params } = mapper(cmd.params || {});
      // Prefer the native handler: it runs whatever the JS thread is doing, which is
      // what the local REST API has always done. Only commands the native layer cannot
      // finish on its own fall through to the JS path below.
      const native = await this.tryNative(command, params);
      if (native) return native;
      return await ApiService.executeAction(command, params);
    } catch (error: any) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  /**
   * Save a Wi-Fi network for later, without switching to it. The native side refuses a
   * name the tablet already knows, since Android keeps one configuration per name and
   * replacing the one in use would disconnect a remote kiosk. See saveNetworkForLater.
   * The password is never echoed back in the result.
   */
  private async saveWifiNetwork(params: Record<string, any>): Promise<ActionResult> {
    if (!WifiControlModule?.saveNetworkForLater) {
      return { ok: false, error: 'This app version cannot save Wi-Fi networks' };
    }
    const ssid = typeof params.ssid === 'string' ? params.ssid : '';
    const password = typeof params.password === 'string' ? params.password : '';
    try {
      const saved = await WifiControlModule.saveNetworkForLater(ssid, password);
      return {
        ok: true,
        result: { saved: true, ssid: saved?.ssid ?? ssid, secured: !!saved?.secured },
      };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  /**
   * A new fix for the map. What the tablet found is the result, also when it found nothing: the website
   * puts the reason in words, and keeps the place it knew.
   */
  private async locate(): Promise<ActionResult> {
    const location = await locateNow();
    if (!location) return { ok: false, error: 'This app version cannot locate the device' };
    return { ok: true, result: { location } };
  }

  /** How long the screen stays on with no touch. Android keeps it, across restarts too. */
  private async setVolume(params: Record<string, any>): Promise<ActionResult> {
    const percent = Number(params.percent);
    if (params.percent === '' || !(percent >= 0 && percent <= 100)) {
      return { ok: false, error: 'Missing volume' };
    }
    if (!HttpServerModule?.setVolume) {
      return { ok: false, error: 'This app version cannot change the volume' };
    }
    try {
      await HttpServerModule.setVolume(Math.round(percent));
      return { ok: true, result: { percent: Math.round(percent) } };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  private async setScreenTimeout(params: Record<string, any>): Promise<ActionResult> {
    const seconds = Number(params.seconds);
    if (!Number.isInteger(seconds)) {
      return { ok: false, error: 'Missing screen timeout' };
    }
    if (!KioskModule?.setScreenOffTimeout) {
      return { ok: false, error: 'This app version cannot change the screen timeout' };
    }
    try {
      await KioskModule.setScreenOffTimeout(seconds);
      return { ok: true, result: { seconds } };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  /** Closes what was left open at the end of a lesson, and says which apps that was. */
  private async stopRunningApps(): Promise<ActionResult> {
    if (!KioskModule?.stopRunningApps) {
      return { ok: false, error: 'This app version cannot stop apps' };
    }
    try {
      const [managed, single, mode, displayMode] = await Promise.all([
        StorageService.getManagedApps(),
        StorageService.getExternalAppPackage(),
        StorageService.getExternalAppMode(),
        StorageService.getDisplayMode(),
      ]);
      const packages = managed.map((app) => app.packageName);
      if (single) packages.push(single);
      // Single-app mode reopens its app on any return to FreeKiosk, which is not what was asked
      const blockRelaunch = displayMode === 'external_app' && mode === 'single';
      return { ok: true, result: { stopped: await KioskModule.stopRunningApps(packages, blockRelaunch) } };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  /** Sign-ins, files and settings of these apps go, and the apps stay. An app this tablet lacks is no error */
  private async clearAppData(params: Record<string, any>): Promise<ActionResult> {
    const packages: string[] = Array.isArray(params.packages)
      ? params.packages.filter((name: unknown): name is string => typeof name === 'string' && name.length > 0 && name !== OWN_PACKAGE)
      : [];
    if (packages.length === 0) {
      return { ok: false, error: 'No apps chosen' };
    }
    if (!KioskModule?.clearAppData) {
      return { ok: false, error: 'This app version cannot clear app data' };
    }
    try {
      const outcome = await KioskModule.clearAppData(packages);
      if (outcome.failed.length > 0) {
        return { ok: false, error: `Could not clear the data of ${outcome.failed.join(', ')}`, result: outcome };
      }
      return { ok: true, result: outcome };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? String(error) };
    }
  }

  /**
   * Dispatch through the native command handler. Resolves null when the command needs
   * the JS thread (or the native build predates this bridge), so the caller falls back.
   */
  private async tryNative(
    command: string,
    params: Record<string, any>,
  ): Promise<ActionResult | null> {
    if (!HttpServerModule?.executeNativeCommand) return null;
    try {
      const raw: string = await HttpServerModule.executeNativeCommand(
        command,
        JSON.stringify(params ?? {}),
      );
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || parsed.nativelyHandled === false) return null;
      return { ok: true, result: parsed };
    } catch {
      // Never let a native failure swallow the command: let the JS path have its turn.
      return null;
    }
  }

  /**
   * Capture the current screen (reusing the same native capture as the local
   * REST `/api/screenshot`) and upload it to the cloud screenshot endpoint.
   */
  private async captureAndUploadScreenshot(c: CloudCredentials): Promise<ActionResult> {
    if (!HttpServerModule?.captureScreenshotBase64) {
      return { ok: false, error: 'Screenshot capture unavailable on this build' };
    }

    let tmpPath: string | null = null;
    try {
      const base64: string = await HttpServerModule.captureScreenshotBase64();
      if (!base64) return { ok: false, error: 'Empty screenshot' };

      // RN multipart file uploads need a file URI, so stage the PNG on disk.
      tmpPath = `${RNFS.CachesDirectoryPath}/cloud-screenshot-${Date.now()}.png`;
      await RNFS.writeFile(tmpPath, base64, 'base64');

      const form = new FormData();
      form.append('image', {
        uri: `file://${tmpPath}`,
        type: 'image/png',
        name: 'screenshot.png',
      } as any);
      form.append('captured_at', new Date().toISOString());

      const res = await fetch(`${c.cloudUrl}/api/v1/devices/${c.deviceId}/screenshot/`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${c.apiKey}` },
        body: form,
      });
      if (!res.ok) {
        return { ok: false, error: `Screenshot upload failed: HTTP ${res.status}` };
      }
      return { ok: true, result: { uploaded: true } };
    } catch (error: any) {
      return { ok: false, error: error?.message ?? String(error) };
    } finally {
      if (tmpPath) {
        RNFS.unlink(tmpPath).catch(() => {/* best-effort cleanup */});
      }
    }
  }

  // ─── APK update channel (install_apk) ────────────────────────────────────────

  private async pollUpdates(c: CloudCredentials): Promise<void> {
    const res = await fetch(`${c.cloudUrl}/api/v1/devices/${c.deviceId}/updates/`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${c.apiKey}` },
    });
    if (!res.ok) return;

    const updates: CloudUpdate[] = (await res.json()) ?? [];

    for (const u of updates) {
      if (!u.command_id || this.processed.has(u.command_id)) continue;
      this.processed.add(u.command_id);

      // A self-update replaces this process mid-install, so the marker is what
      // lets the result be reported once the new version comes up.
      this.underWay.add(u.command_id);
      await StorageService.saveInflightInstall({
        commandId: u.command_id,
        type: 'install_apk',
        killsProcess: u.package_name === OWN_PACKAGE,
      } satisfies InflightCommand);

      try {
        const result = await ManagedAppInstaller.installFromUrl(
          u.download_url,
          c.apiKey, // the download endpoint is authenticated with the device API key
          u.package_name ?? null,
        );
        await StorageService.saveInflightInstall(null);
        await this.reportResult(c, u.command_id, {
          ok: true,
          result: {
            installed_package: u.package_name ?? '',
            version: u.version_name ?? '',
            install_status: result?.status ?? 'success',
          },
        });
      } catch (error: any) {
        await StorageService.saveInflightInstall(null);
        await this.reportResult(c, u.command_id, {
          ok: false,
          error: error?.message ?? String(error),
        });
      } finally {
        this.underWay.delete(u.command_id);
      }
    }
  }

  // ─── Result reporting ────────────────────────────────────────────────────────

  private async reportResult(
    c: CloudCredentials,
    commandId: string,
    outcome: ActionResult,
  ): Promise<void> {
    const report: PendingReport = {
      commandId,
      status: outcome.ok ? 'success' : 'error',
      result: outcome.result ?? null,
      errorMessage: outcome.ok ? '' : outcome.error ?? 'Unknown error',
      attempts: 0,
    };
    const sent = await this.postResult(c, report);
    if (!sent) {
      // The command did run. Queue the result so the dashboard eventually learns
      // its outcome instead of showing it as 'sent' with no answer for ever.
      await this.enqueueReport(report);
    }
  }

  /** POST one result. Returns whether the server accepted it. */
  private async postResult(c: CloudCredentials, report: PendingReport): Promise<boolean> {
    try {
      const res = await fetch(`${c.cloudUrl}/api/v1/commands/${report.commandId}/result/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${c.apiKey}`,
        },
        body: JSON.stringify({
          status: report.status,
          result: report.result,
          error_message: report.errorMessage,
        }),
      });
      // A 4xx means the server will never accept this result (expired, unknown id),
      // so treat it as done rather than retrying it until the attempt cap.
      if (!res.ok && res.status >= 500) return false;
      return true;
    } catch (error) {
      console.error('[CloudCommand] Failed to report result for', report.commandId, error);
      return false;
    }
  }
}

export const CloudCommandService = new CloudCommandServiceClass();
