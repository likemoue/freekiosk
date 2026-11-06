import { BadRequestException, Injectable } from '@nestjs/common';
import { DeviceWakeService } from '../common/device-wake.service';

/** A page showing screens says so again every few seconds: one gone quiet this long has left */
const VIEWER_TTL_MS = 15_000;
/** A tablet that sent nothing for this long is not streaming: it is woken again */
const STALE_MS = 8_000;
const REWAKE_MS = 10_000;
const MAX_INPUTS = 30;

export type LiveMode = 'grid' | 'detail';

export interface LiveInput {
  type: 'tap' | 'long_press' | 'swipe' | 'key' | 'text';
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  ms?: number;
  key?: 'back' | 'home' | 'recents' | 'enter' | 'backspace';
  text?: string;
}

export interface LiveFrame {
  jpeg: Buffer;
  seq: number;
  at: number;
  width: number;
  height: number;
}

interface Session {
  viewers: Map<string, { mode: LiveMode; until: number }>;
  frame: LiveFrame | null;
  /** Why the last round brought no picture: the screen is off, capture is refused... */
  problem: string | null;
  /** Whether the tablet can take taps: its accessibility service has the gesture capability */
  control: boolean;
  inputs: LiveInput[];
  lastFrameAt: number;
  wokenAt: number;
  seq: number;
}

export interface LiveStatus {
  deviceId: string;
  streaming: boolean;
  seq: number;
  at: number | null;
  width: number | null;
  height: number | null;
  problem: string | null;
  control: boolean;
}

/**
 * The screens on the Screenshots page, live (LiveScreen.kt in the app). Only the last picture of each
 * tablet is kept, in memory: nothing is stored, and what a restart forgets the next round sends again.
 *
 * A tablet sends pictures while someone watches it, every five seconds for the grid and every second
 * for one screen opened full size, and takes the taps queued for it with the answer to each picture.
 */
@Injectable()
export class LiveService {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly wake: DeviceWakeService) {}

  private session(deviceId: string): Session {
    let session = this.sessions.get(deviceId);
    if (!session) {
      session = { viewers: new Map(), frame: null, problem: null, control: false, inputs: [], lastFrameAt: 0, wokenAt: 0, seq: 0 };
      this.sessions.set(deviceId, session);
    }
    return session;
  }

  private prune(session: Session, now: number) {
    for (const [viewer, seen] of session.viewers) if (seen.until < now) session.viewers.delete(viewer);
  }

  private status(deviceId: string, session: Session | undefined, now: number): LiveStatus {
    return {
      deviceId,
      streaming: !!session && now - session.lastFrameAt < STALE_MS,
      seq: session?.frame?.seq ?? 0,
      at: session?.frame?.at ?? null,
      width: session?.frame?.width ?? null,
      height: session?.frame?.height ?? null,
      problem: session?.problem ?? null,
      control: session?.control ?? false,
    };
  }

  /** A page that shows these screens, again every few seconds while it does. Tablets not streaming are woken */
  watch(viewer: string, deviceIds: string[], mode: LiveMode): LiveStatus[] {
    const now = Date.now();
    const toWake: string[] = [];
    const statuses = deviceIds.map((deviceId) => {
      const session = this.session(deviceId);
      session.viewers.set(viewer, { mode, until: now + VIEWER_TTL_MS });
      if (now - session.lastFrameAt > STALE_MS && now - session.wokenAt > REWAKE_MS) {
        session.wokenAt = now;
        toWake.push(deviceId);
      }
      return this.status(deviceId, session, now);
    });
    if (toWake.length) this.wake.notify(toWake, 'live');
    return statuses;
  }

  unwatch(viewer: string): void {
    for (const session of this.sessions.values()) session.viewers.delete(viewer);
  }

  /** What a tablet sends each round; the answer says whether to go on, how, and what to do */
  frame(deviceId: string, jpeg: Buffer | null, width: number, height: number, problem: string | null, control: boolean) {
    const now = Date.now();
    const session = this.sessions.get(deviceId);
    if (session) this.prune(session, now);
    if (!session || session.viewers.size === 0) {
      this.sessions.delete(deviceId);
      return { active: false };
    }
    session.lastFrameAt = now;
    session.control = control;
    if (jpeg && jpeg.length > 0) {
      session.seq += 1;
      session.frame = { jpeg, seq: session.seq, at: now, width, height };
      session.problem = null;
    } else {
      session.problem = problem || 'no_frame';
    }
    const detail = [...session.viewers.values()].some((seen) => seen.mode === 'detail');
    const inputs = session.inputs.splice(0);
    return {
      active: true,
      interval_ms: detail ? 1_000 : 5_000,
      max_width: detail ? 1_280 : 480,
      quality: detail ? 65 : 45,
      inputs,
    };
  }

  latest(deviceId: string): LiveFrame | null {
    return this.sessions.get(deviceId)?.frame ?? null;
  }

  /** Only for a screen someone has open full size: a tap meant for nobody's eyes is not sent */
  input(deviceId: string, input: LiveInput): void {
    const session = this.sessions.get(deviceId);
    const now = Date.now();
    if (session) this.prune(session, now);
    if (!session || ![...session.viewers.values()].some((seen) => seen.mode === 'detail')) {
      throw new BadRequestException('Màn hình này chưa mở để điều khiển');
    }
    if (session.inputs.length >= MAX_INPUTS) throw new BadRequestException('Máy chưa kịp làm các thao tác trước, hãy chờ một chút');
    session.inputs.push(input);
  }
}
