/**
 * The time FreeKiosk Cloud gives, for what depends on the time of day.
 *
 * A TV box often has no battery-backed clock and no network time: it can be hours off, and a
 * schedule judged by that clock plays the wrong playlist. Every heartbeat answer carries the
 * server's time (`server_time`); the gap between it and the device's clock is kept, and the
 * digital signage schedule reads the time through `ServerClock.now()`.
 *
 * Only what the cloud decides is corrected: the device's own timers, sleep schedule and the like
 * keep the device's clock. The time zone is the device's, as before: a rule says "9:00" in
 * the venue's local time.
 *
 * Rules:
 *   - a gap under a minute is network and rounding, and is ignored: the device's clock is used
 *   - an answer that took long to come back says little about the time it was sent at: ignored
 *   - the gap is kept across restarts, so a device that boots without network is as right as
 *     it was; the first heartbeat after the boot measures it again
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@kiosk_server_clock_offset';
/** Under this, the device's clock is used as it is */
export const MIN_OFFSET_MS = 60_000;
/** An exchange slower than this is not precise enough to measure a gap with */
export const MAX_ROUND_TRIP_MS = 15_000;

let offsetMs = 0;
let loaded: Promise<void> | null = null;

/** For screens playing in step, where tens of milliseconds show: see calibrate() */
const SAMPLES_KEPT = 12;
const SAMPLE_MAX_AGE_MS = 10 * 60_000;
const SAMPLE_TIMEOUT_MS = 5_000;
let fineOffsetMs: number | null = null;
let samples: Array<{ offset: number; roundTrip: number; at: number }> = [];

/**
 * The epoch of an ISO 8601 time, or NaN. The cloud writes microseconds and "+00:00"
 * ("2026-10-15T16:00:00.169773+00:00"), which not every JavaScript engine reads: it is
 * brought to milliseconds and "Z" first.
 */
export function parseServerTime(value: string): number {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/.exec(value.trim());
  if (!match) return NaN;
  const [, base, fraction, zone] = match;
  const millis = fraction ? `.${fraction.slice(0, 3).padEnd(3, '0')}` : '';
  return Date.parse(`${base}${millis}${zone === '+00:00' || zone === '-00:00' ? 'Z' : zone}`);
}

function load(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY);
        const value = raw === null ? NaN : Number(raw);
        if (Number.isFinite(value)) offsetMs = value;
      } catch {
        // No stored gap: the device's clock
      }
    })();
  }
  return loaded;
}

export const ServerClock = {
  /** The time now, for what the cloud's schedule decides */
  async now(): Promise<Date> {
    await load();
    return new Date(Date.now() + offsetMs);
  },

  /** The gap kept, in milliseconds (server minus device): 0 when the device's clock is right */
  async offset(): Promise<number> {
    await load();
    return offsetMs;
  },

  /** The gap to use for playing in step, in milliseconds: the measured one once there is one */
  fineOffset(): number {
    return fineOffsetMs ?? offsetMs;
  },

  /**
   * Measures the gap to the millisecond, which the heartbeat cannot: its request carries the whole
   * configuration, and a gap under a minute is ignored there. The fastest exchange of the last few
   * minutes says the most, since the less time a request spends on the way, the less that time can
   * lean to one side. Screens on one network take the same road, so what is left of the error is
   * the same for all of them and does not show between them.
   */
  async calibrate(cloudUrl: string, count = 5): Promise<number> {
    await load();
    for (let i = 0; i < count; i += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), SAMPLE_TIMEOUT_MS);
      try {
        const sentAt = Date.now();
        const response = await fetch(`${cloudUrl}/api/v1/time/`, { signal: controller.signal });
        const receivedAt = Date.now();
        if (!response.ok) break; // A server without this route
        const { now } = await response.json();
        if (typeof now === 'number') {
          const roundTrip = receivedAt - sentAt;
          samples.push({ offset: now - (sentAt + roundTrip / 2), roundTrip, at: receivedAt });
        }
      } catch {
        // No network: what was measured before still holds
      } finally {
        clearTimeout(timer);
      }
    }
    const oldest = Date.now() - SAMPLE_MAX_AGE_MS;
    samples = samples.filter((sample) => sample.at >= oldest).slice(-SAMPLES_KEPT);
    if (samples.length > 0) {
      const best = samples.reduce((a, b) => (b.roundTrip < a.roundTrip ? b : a));
      fineOffsetMs = Math.round(best.offset);
    }
    return this.fineOffset();
  },

  /**
   * Take what a heartbeat answer says. `sentAt` and `receivedAt` are the device's clock when
   * the request left and when the answer arrived; the server's time is put in the middle.
   */
  async observe(serverTime: unknown, sentAt: number, receivedAt: number): Promise<void> {
    await load();
    if (typeof serverTime !== 'string') return;
    const server = parseServerTime(serverTime);
    if (!Number.isFinite(server)) return; // the old test value 'now', a missing zone...
    const roundTrip = receivedAt - sentAt;
    if (!(roundTrip >= 0) || roundTrip > MAX_ROUND_TRIP_MS) return;
    const gap = server - (sentAt + roundTrip / 2);
    const next = Math.abs(gap) < MIN_OFFSET_MS ? 0 : Math.round(gap);
    if (next === offsetMs) return;
    offsetMs = next;
    try {
      await AsyncStorage.setItem(KEY, String(next));
    } catch {
      // Kept for this run only
    }
  },

  /** For tests */
  _reset(): void {
    offsetMs = 0;
    loaded = null;
    fineOffsetMs = null;
    samples = [];
  },
};
