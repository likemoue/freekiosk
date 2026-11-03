/** The offset of a time zone at an instant, in milliseconds east of UTC */
function zoneOffsetMs(timeZone: string, at: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(at / 1000) * 1000;
}

function localToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month, day, hour, minute);
  const first = guess - zoneOffsetMs(timeZone, guess);
  // Asked again at the result, for a time close to a daylight-saving change
  return new Date(guess - zoneOffsetMs(timeZone, first));
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** The next time a task runs: `days` are ISO weekdays (Monday is 1), `time` is HH:MM in the zone */
export function computeNextRun(days: number[], time: string, timeZone: string, after: Date = new Date()): Date | null {
  const [hour, minute] = time.split(':').map(Number);
  if (!days.length || Number.isNaN(hour) || Number.isNaN(minute)) return null;
  const offset = zoneOffsetMs(timeZone, after.getTime());
  const local = new Date(after.getTime() + offset);
  for (let add = 0; add <= 8; add++) {
    const day = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + add));
    const iso = ((day.getUTCDay() + 6) % 7) + 1;
    if (!days.includes(iso)) continue;
    const candidate = localToUtc(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour, minute, timeZone);
    if (candidate > after) return candidate;
  }
  return null;
}
