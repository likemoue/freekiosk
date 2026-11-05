/**
 * Screens play a playlist in step by each working out, from the same clock and the same lengths,
 * where they should be: the same answer on every screen, whenever each one started.
 */
export {};

jest.mock('react-native-webview', () => ({ WebView: 'WebView' }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const AsyncStorage = require('@react-native-async-storage/async-storage');
const { IN_STEP_PLAYER_JS, SIGNAGE_TIMELINE_JS } = require('../src/utils/SignageTimeline');
const { generatePlayerHTML } = require('../src/components/MediaPlayerComponent');
const { manifestToItems, SignagePlaylist } = require('../src/utils/SignagePlaylist');
const { activeRuleStart } = require('../src/utils/SignageSchedule');
const { ServerClock } = require('../src/utils/ServerClock');

// The text that runs in the player's page, run here as it is
const page = new Function(`${SIGNAGE_TIMELINE_JS}; return { buildTimeline, locateInTimeline, nextInTimeline, correctionFor };`)();

describe('where a screen should be', () => {
  const timeline = page.buildTimeline([10_000, 5_000, 20_000]);
  const at = (ms: number) => page.locateInTimeline(timeline, ms);

  it('waits for the start, on the first item', () => {
    expect(at(-3000)).toMatchObject({ index: 0, intoMs: 0, waiting: true });
  });

  it('starts at the start', () => {
    expect(at(0)).toMatchObject({ index: 0, intoMs: 0, untilNextMs: 10_000, cycle: 0, waiting: false });
  });

  it('finds the item and how far into it', () => {
    expect(at(9_999)).toMatchObject({ index: 0, intoMs: 9_999, untilNextMs: 1 });
    expect(at(10_000)).toMatchObject({ index: 1, intoMs: 0 });
    expect(at(14_500)).toMatchObject({ index: 1, intoMs: 4_500 });
    expect(at(34_999)).toMatchObject({ index: 2, intoMs: 19_999, untilNextMs: 1 });
  });

  it('goes round for ever, counting the rounds', () => {
    expect(at(35_000)).toMatchObject({ index: 0, intoMs: 0, cycle: 1 });
    expect(at(35_000 * 1000 + 12_000)).toMatchObject({ index: 1, intoMs: 2_000, cycle: 1000 });
  });

  it('gives two screens the same place, whenever each one looks', () => {
    const elapsed = 987_654_321;
    expect(page.locateInTimeline(page.buildTimeline([10_000, 5_000, 20_000]), elapsed)).toEqual(at(elapsed));
  });

  it('knows what comes next, round to the first', () => {
    expect(page.nextInTimeline(timeline, at(1000))).toEqual({ index: 1, cycle: 0 });
    expect(page.nextInTimeline(timeline, at(20_000))).toEqual({ index: 0, cycle: 1 });
  });

  it('treats one item as a loop of its own', () => {
    const one = page.buildTimeline([8_000]);
    expect(page.locateInTimeline(one, 8_500)).toMatchObject({ index: 0, intoMs: 500, cycle: 1 });
    expect(page.nextInTimeline(one, page.locateInTimeline(one, 8_500))).toEqual({ index: 0, cycle: 2 });
  });
});

describe('closing a gap', () => {
  it('leaves alone what nobody can see', () => {
    expect(page.correctionFor(0)).toEqual({ seek: false, rate: 1 });
    expect(page.correctionFor(0.03)).toEqual({ seek: false, rate: 1 });
  });

  it('plays a little slower when ahead, a little faster when behind', () => {
    expect(page.correctionFor(0.2).rate).toBeCloseTo(0.8);
    expect(page.correctionFor(-0.2).rate).toBeCloseTo(1.2);
    expect(page.correctionFor(0.1).rate).toBeCloseTo(0.9);
  });

  it('never bends the speed further than a person would not notice', () => {
    expect(page.correctionFor(0.59).rate).toBeCloseTo(0.75);
    expect(page.correctionFor(-0.59).rate).toBeCloseTo(1.25);
  });

  it('seeks when the gap is too big for that', () => {
    expect(page.correctionFor(0.7).seek).toBe(true);
    expect(page.correctionFor(-30).seek).toBe(true);
  });
});

describe('a video that takes time to begin', () => {
  // The player itself, with a clock and a tablet made up: this video begins 300 ms after it is told to
  const BEGINS_AFTER_MS = 300;
  const setUp = () => {
    let now = 1_000_000;
    const timers: Array<{ at: number; run: () => void }> = [];
    const videos: any[] = [];
    const slot = () => ({ innerHTML: '', classList: { add() {}, remove() {} }, appendChild() {}, querySelector: () => null });
    const slots = { A: slot(), B: slot() };
    const makeVideo = () => {
      const video: any = {
        paused: true, ended: false, seeking: false, readyState: 4, duration: 10, playbackRate: 1, muted: false, toldAt: null,
        listeners: {} as Record<string, () => void>,
        setAttribute() {},
        removeEventListener() {},
        addEventListener(name: string, listener: () => void) { video.listeners[name] = listener; },
        play() {
          video.paused = false;
          if (video.toldAt === null) video.toldAt = now;
          return Promise.resolve();
        },
        pause() { video.paused = true; },
        get currentTime() {
          if (video.toldAt === null) return 0;
          return Math.max(0, now - video.toldAt - BEGINS_AFTER_MS) / 1000;
        },
        set currentTime(_seconds: number) {},
      };
      videos.push(video);
      return video;
    };
    const fakes = {
      playlist: [{ type: 'video', url: 'a', durationMs: 5000, duration: 5 }],
      SETTINGS: { muteVideo: true, transitionEnabled: false, transitionDuration: 0 },
      SYNC: { epochMs: now, offsetMs: 0 },
      document: { createElement: makeVideo },
      window: {},
      Date: { now: () => now },
      setTimeout: (run: () => void, ms: number) => { timers.push({ at: now + ms, run }); return timers.length; },
      clearTimeout() {},
      setInterval() { return 0; },
      showLoading() {},
      hideLoading() {},
      isOffline: () => false,
      makeFrame: () => null,
      getActiveSlot: () => slots.A,
      getInactiveSlot: () => slots.B,
      activeSlot: 'A',
    };
    const names = Object.keys(fakes);
    const player = new Function(...names, `${SIGNAGE_TIMELINE_JS}\n${IN_STEP_PLAYER_JS}\nreturn { stepRun, stepTick, leads: stepLeadMs };`)(...names.map((n) => (fakes as any)[n]));
    const passTo = (end: number) => {
      while (now < end) {
        now += 50;
        timers.filter((t) => t.at <= now).forEach((t) => { timers.splice(timers.indexOf(t), 1); t.run(); });
        if (now % 200 === 0) player.stepTick();
        videos.forEach((v) => v.listeners.loadeddata?.());
      }
    };
    player.stepRun([5000], () => { throw new Error('fell back'); });
    return { player, videos, passTo, start: now };
  };

  it('finds out how late it began', () => {
    const { player, passTo, start } = setUp();
    passTo(start + 1000);
    expect(player.leads[0]).toBeGreaterThan(100);
    expect(player.leads[0]).toBeLessThanOrEqual(BEGINS_AFTER_MS);
  });

  it('is told that much earlier the next time, and the time after it begins on time', () => {
    const { videos, passTo, start } = setUp();
    passTo(start + 16_000);
    // The turns begin every 5 seconds. The first is told when it comes, the later ones ever closer to what it takes
    const early = videos.slice(0, 4).map((video, i) => start + i * 5000 - video.toldAt);
    expect(early[0]).toBeLessThanOrEqual(0);
    expect(early[1]).toBeGreaterThan(100);
    expect(early[2]).toBeGreaterThan(early[1] - 1);
    expect(Math.abs(early[3] - BEGINS_AFTER_MS)).toBeLessThan(100);
  });
});

describe('the player page', () => {
  const SETTINGS = {
    autoPlay: true, loop: true, shuffle: true, imageDuration: 25, showControls: false, fitMode: 'contain',
    backgroundColor: '#000000', transitionEnabled: false, transitionDuration: 300, muteVideo: false, unattended: true,
  };
  const ITEMS = [
    { id: 'a', url: 'https://x/a.mp4', type: 'video', durationMs: 7500 },
    { id: 'b', url: 'https://x/b.png', type: 'image' },
  ];
  const playlistOf = (html: string) => {
    const line = html.split('\n').find((l: string) => l.includes('var playlist = ')) as string;
    return new Function(`return ${line.slice(line.indexOf('= ') + 2).replace(/;\s*$/, '')};`)();
  };

  it('gets the start and the clock when it plays in step', () => {
    const html: string = generatePlayerHTML({ ...SETTINGS, items: ITEMS, sync: { epochMs: 1234, offsetMs: 56 } });
    expect(html).toContain('var SYNC = {"epochMs":1234,"offsetMs":56};');
    expect(html).toContain('if (SYNC && playlist.length > 0) startInStep(startOneAfterTheOther);');
    expect(playlistOf(html)[0].durationMs).toBe(7500);
  });

  it('does not let the setting of one screen decide how long an image lasts', () => {
    const html: string = generatePlayerHTML({ ...SETTINGS, items: ITEMS, sync: { epochMs: 1, offsetMs: 0 } });
    expect(playlistOf(html)[1].duration).toBe(10);
  });

  it('plays as it always did without a start', () => {
    const html: string = generatePlayerHTML({ ...SETTINGS, items: ITEMS });
    expect(html).toContain('var SYNC = null;');
    expect(playlistOf(html)[1].duration).toBe(25);
  });

  it('is one script that parses, in step or not', () => {
    for (const sync of [null, { epochMs: 1, offsetMs: 0 }]) {
      const html: string = generatePlayerHTML({ ...SETTINGS, items: ITEMS, sync });
      const script = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));
      expect(() => new Function(script)).not.toThrow();
    }
  });
});

describe('what the cloud says', () => {
  beforeEach(() => AsyncStorage.clear());

  const creds = { cloudUrl: 'https://cloud.test', deviceId: 'd', apiKey: 'k' };
  const answers = (manifest: Record<string, unknown>) => {
    (globalThis as any).fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) }));
  };

  it('keeps the length of a video, not of anything else', () => {
    const items = manifestToItems([
      { kind: 'video', url: 'https://x/a.mp4', duration_ms: 7500 },
      { kind: 'video', url: 'https://x/b.mp4' },
      { kind: 'image', url: 'https://x/c.png', duration_ms: 7500 },
    ]);
    expect(items.map((item: any) => item.durationMs)).toEqual([7500, undefined, undefined]);
  });

  it('remembers when the playlist began', async () => {
    answers({ version: 'v1', playlist: { name: 'Sảnh' }, items: [{ kind: 'image', url: 'https://x/c.png' }], sync_epoch_ms: 1_800_000_000_000 });
    await SignagePlaylist.sync(creds, 'v1');
    expect((await SignagePlaylist.getActive()).syncEpochMs).toBe(1_800_000_000_000);
  });

  it('says nothing of it from an older cloud', async () => {
    answers({ version: 'v1', playlist: { name: 'Sảnh' }, items: [{ kind: 'image', url: 'https://x/c.png' }] });
    await SignagePlaylist.sync(creds, 'v1');
    expect((await SignagePlaylist.getActive()).syncEpochMs).toBeNull();
  });

  describe('with a schedule', () => {
    const rule = (start: string | null, end: string | null) => ({ playlist: 'p', days: [1, 2, 3, 4, 5, 6, 7], start, end, from: null, to: null });
    const schedule = (rules: unknown[]) => ({ default_playlist: 'd', playlists: { p: { name: '', items: [] }, d: { name: '', items: [] } }, rules });

    it('starts a playlist from the moment its hours begin, on every screen', () => {
      const now = new Date(2026, 10, 5, 10, 30);
      expect(activeRuleStart(schedule([rule('09:00', '17:00')]), now)).toBe(new Date(2026, 10, 5, 9, 0).getTime());
    });

    it('counts from last evening in the small hours', () => {
      const now = new Date(2026, 10, 5, 1, 0);
      expect(activeRuleStart(schedule([rule('22:00', '06:00')]), now)).toBe(new Date(2026, 10, 4, 22, 0).getTime());
    });

    it('has no such moment for a rule of a whole day, or for no rule', () => {
      const now = new Date(2026, 10, 5, 10, 30);
      expect(activeRuleStart(schedule([rule(null, null)]), now)).toBeNull();
      expect(activeRuleStart(schedule([]), now)).toBeNull();
      expect(activeRuleStart(schedule([rule('18:00', '19:00')]), now)).toBeNull();
    });

    it('falls back on when that playlist began', async () => {
      answers({
        version: 'v2',
        items: [],
        schedule: {
          default_playlist: 'd',
          playlists: { d: { name: 'Mặc định', items: [{ kind: 'image', url: 'https://x/c.png' }], sync_epoch_ms: 111 } },
          rules: [],
        },
      });
      await SignagePlaylist.sync(creds, 'v2');
      expect((await SignagePlaylist.getActive()).syncEpochMs).toBe(111);
    });
  });
});

describe('the clock to the millisecond', () => {
  const CLOUD = 'https://cloud.test';
  let clock: number[];
  let realNow: () => number;

  beforeEach(() => {
    ServerClock._reset();
    realNow = Date.now;
  });
  afterEach(() => {
    Date.now = realNow;
  });

  /** Each exchange: when it left, how long it took, and what the server said its clock read */
  function exchanges(list: Array<[number, number, number]>) {
    clock = list.flatMap(([sent, took]) => [sent, sent + took]);
    const base = list[0][0];
    let i = 0;
    Date.now = () => (i < clock.length ? clock[i++] : clock[clock.length - 1]);
    let served = 0;
    (globalThis as any).fetch = jest.fn(() => {
      const [, , now] = list[served++];
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ now }) });
    });
    return base;
  }

  it('trusts the fastest exchange', async () => {
    exchanges([
      [1000, 400, 6300], // slow, and the time it spent on the way leans to one side
      [2000, 20, 7010],
      [3000, 100, 8060],
    ]);
    expect(await ServerClock.calibrate(CLOUD, 3)).toBe(5000);
    expect(ServerClock.fineOffset()).toBe(5000);
  });

  it('does not ignore a small gap, as the schedule does', async () => {
    exchanges([[1000, 10, 1045]]);
    expect(await ServerClock.calibrate(CLOUD, 1)).toBe(40);
    expect(await ServerClock.offset()).toBe(0);
  });

  it('keeps what it measured when the network goes', async () => {
    exchanges([[1000, 10, 1045]]);
    await ServerClock.calibrate(CLOUD, 1);
    Date.now = realNow;
    (globalThis as any).fetch = jest.fn(() => Promise.reject(new Error('offline')));
    await ServerClock.calibrate(CLOUD, 2);
    // Old samples age out only after minutes: the gap holds
    expect(typeof ServerClock.fineOffset()).toBe('number');
  });

  it('uses the coarse gap of the heartbeat until it has measured', () => {
    expect(ServerClock.fineOffset()).toBe(0);
  });
});
