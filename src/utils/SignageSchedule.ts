/**
 * Which playlist plays now, from the schedule FreeKiosk Cloud hands the device.
 *
 * The device decides with its own clock (local time), so it changes playlist on time even
 * when it is offline. The rules arrive in order of precedence: the first one that matches
 * wins. Nothing matches: the default playlist, or none (a blank screen) when there is none.
 * The contract is in the cloud repository (ANDROID_INTEGRATION.md, "Schedules").
 *
 * A rule matches when, today and at this time:
 *   - the ISO weekday (Monday is 1, Sunday is 7) is in `days`
 *   - the date is within `from` and `to` (YYYY-MM-DD, inclusive, either may be null)
 *   - the time is from `start` (included) to `end` (excluded), HH:MM; both null: all day
 * An `end` before the `start` runs past midnight: the evening belongs to the day in `days`,
 * the hours after midnight to the next day, and the dates are checked against the day the
 * rule started on. A rule that is malformed never matches.
 */

export interface ScheduleRule {
  playlist: string;
  days: number[];
  start: string | null;
  end: string | null;
  from: string | null;
  to: string | null;
  priority?: number;
}

export interface Schedule<Items = unknown> {
  default_playlist: string | null;
  playlists: Record<string, { name: string; items: Items; syncEpochMs?: number }>;
  rules: ScheduleRule[];
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** YYYY-MM-DD in local time */
function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday is 1, Sunday is 7 */
function isoWeekday(d: Date): number {
  return ((d.getDay() + 6) % 7) + 1;
}

/** Minutes since midnight from "HH:MM", or null when it is not a time */
function minutesOf(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True when the date is within the bounds; undefined when a bound is malformed (rule ignored) */
function dateWithin(date: string, from: unknown, to: unknown): boolean | undefined {
  if (from !== null && from !== undefined && !(typeof from === 'string' && DATE.test(from))) return undefined;
  if (to !== null && to !== undefined && !(typeof to === 'string' && DATE.test(to))) return undefined;
  if (typeof from === 'string' && date < from) return false;
  if (typeof to === 'string' && date > to) return false;
  return true;
}

export function ruleMatches(rule: ScheduleRule, now: Date): boolean {
  if (!rule || !Array.isArray(rule.days)) return false;
  const days = rule.days;
  const today = isoWeekday(now);
  const yesterdayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const yesterday = isoWeekday(yesterdayDate);

  const wantsTimes = (rule.start !== null && rule.start !== undefined)
    || (rule.end !== null && rule.end !== undefined);
  if (!wantsTimes) {
    const within = dateWithin(localDate(now), rule.from, rule.to);
    return days.includes(today) && within === true;
  }

  const start = minutesOf(rule.start);
  const end = minutesOf(rule.end);
  if (start === null || end === null || start === end) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();

  if (start < end) {
    const within = dateWithin(localDate(now), rule.from, rule.to);
    return days.includes(today) && within === true && minutes >= start && minutes < end;
  }

  // Past midnight: the evening of a listed day, and the morning that follows it
  const eveningWithin = dateWithin(localDate(now), rule.from, rule.to);
  if (days.includes(today) && eveningWithin === true && minutes >= start) return true;
  const morningWithin = dateWithin(localDate(yesterdayDate), rule.from, rule.to);
  return days.includes(yesterday) && morningWithin === true && minutes < end;
}

/**
 * When the rule in force at `now` began, for a rule with hours, or null. A playlist that a schedule
 * brings on starts from its first item at that moment, on every screen following the rule.
 */
export function activeRuleStart(schedule: Schedule, now: Date): number | null {
  const rules = Array.isArray(schedule?.rules) ? schedule.rules : [];
  for (const rule of rules) {
    if (!ruleMatches(rule, now) || !schedule.playlists?.[rule.playlist]) continue;
    const start = minutesOf(rule.start);
    if (start === null) return null;
    const began = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, start);
    // Past midnight, in the morning part: it began last evening
    if (now.getHours() * 60 + now.getMinutes() < start) began.setDate(began.getDate() - 1);
    return began.getTime();
  }
  return null;
}

/** The id of the playlist that plays at `now`, or null for a blank screen. */
export function activePlaylistId(schedule: Schedule, now: Date): string | null {
  const rules = Array.isArray(schedule?.rules) ? schedule.rules : [];
  for (const rule of rules) {
    if (ruleMatches(rule, now) && schedule.playlists && schedule.playlists[rule.playlist]) {
      return rule.playlist;
    }
  }
  const fallback = schedule?.default_playlist;
  return typeof fallback === 'string' && schedule.playlists?.[fallback] ? fallback : null;
}
