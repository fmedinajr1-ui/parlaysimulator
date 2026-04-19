// _shared/date-et.ts
// All ET date handling. Do not roll your own.

const ET = 'America/New_York';

/** "2026-04-19" — ISO date in ET, used for DB keys. */
export function etDateKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** "Apr 19" — short human form for message headers. */
export function etDateShort(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    month: 'short',
    day: 'numeric',
  }).format(at);
}

/** "Sunday, April 19" — long form for major announcements. */
export function etDateLong(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(at);
}

/** "7:32 PM" — short time, ET. */
export function etTime(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(at);
}

/** Hour of day in ET, 0-23. Always safe — never returns 24. */
export function etHour(at: Date = new Date()): number {
  const s = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour: '2-digit',
    hour12: false,
  }).format(at);
  return parseInt(s, 10) % 24;
}

/** Minutes past midnight ET, 0-1439. Useful for phase scheduling. */
export function etMinutesOfDay(at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ET,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const h = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10) % 24;
  const m = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
  return h * 60 + m;
}

/** Date key N days ago in ET. */
export function etDateKeyDaysAgo(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - days);
  return etDateKey(d);
}

/** Time-of-day register: which tonal bucket is the bot in right now? */
export type TimeOfDay = 'early_morning' | 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' | 'late_night';

export function timeOfDay(at: Date = new Date()): TimeOfDay {
  const h = etHour(at);
  if (h < 6) return 'late_night';
  if (h < 9) return 'early_morning';
  if (h < 12) return 'morning';
  if (h < 14) return 'midday';
  if (h < 18) return 'afternoon';
  if (h < 22) return 'evening';
  return 'night';
}
