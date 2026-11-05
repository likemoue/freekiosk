import { Injectable } from '@nestjs/common';

export interface WakeReason {
  /** A command or an APK is waiting: fetch them */
  commands: boolean;
  /** A setting, a playlist or the name changed: send a heartbeat, its answer carries them */
  config: boolean;
}

export interface WakeAnswer extends WakeReason {
  wake: boolean;
}

/** Below the 60 seconds the proxies in front of the API give an answer to come back */
export const WAKE_HOLD_MS = 25_000;

const NOTHING: WakeAnswer = { wake: false, commands: false, config: false };

/**
 * Tells a tablet at once that something is waiting for it, instead of at its next heartbeat.
 *
 * Each tablet keeps one request open (GET /api/v1/devices/{id}/wait/) and this answers it. It only
 * says "look": what to do still comes through the usual routes, so a tablet that misses the word loses
 * nothing but time. Kept in memory because there is one API process, and what a restart forgets,
 * the next heartbeat delivers.
 */
@Injectable()
export class DeviceWakeService {
  private readonly waiting = new Map<string, (answer: WakeAnswer) => void>();
  /** Said while the tablet was between two requests */
  private readonly queued = new Map<string, WakeReason>();

  notify(deviceIds: Iterable<string>, reason: keyof WakeReason): void {
    for (const id of deviceIds) {
      const answer = this.waiting.get(id);
      if (answer) {
        answer({ wake: true, commands: reason === 'commands', config: reason === 'config' });
        continue;
      }
      const queued = this.queued.get(id) ?? { commands: false, config: false };
      queued[reason] = true;
      this.queued.set(id, queued);
    }
  }

  /** For a change that may concern any tablet, like a playlist. The others hear of it at their next heartbeat */
  notifyConnected(reason: keyof WakeReason): void {
    this.notify([...this.waiting.keys()], reason);
  }

  /** The answer, and what to call when the tablet goes away first */
  wait(deviceId: string, commandsPending: boolean, holdMs = WAKE_HOLD_MS): { answer: Promise<WakeAnswer>; cancel: () => void } {
    // A second request from one tablet means the first one is dead, whatever the network says
    this.waiting.get(deviceId)?.(NOTHING);

    const queued = this.queued.get(deviceId);
    this.queued.delete(deviceId);
    if (queued || commandsPending) {
      return {
        answer: Promise.resolve({ wake: true, commands: !!queued?.commands || commandsPending, config: !!queued?.config }),
        cancel: () => {},
      };
    }

    let settle: (answer: WakeAnswer) => void = () => {};
    const answer = new Promise<WakeAnswer>((resolve) => {
      const timer = setTimeout(() => settle(NOTHING), holdMs);
      settle = (value) => {
        clearTimeout(timer);
        if (this.waiting.get(deviceId) === settle) this.waiting.delete(deviceId);
        resolve(value);
      };
      this.waiting.set(deviceId, settle);
    });
    return { answer, cancel: () => settle(NOTHING) };
  }
}
