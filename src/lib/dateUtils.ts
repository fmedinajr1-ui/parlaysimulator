/**
 * Date utilities for consistent Eastern Time handling
 * All engines use Eastern Time (America/New_York) for game dates
 */

/**
 * Get the current date in Eastern Time (America/New_York)
 * This matches how edge functions calculate game_date
 */
export function getEasternDate(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now); // Returns 'YYYY-MM-DD'
}

/**
 * Get the date N days ago in Eastern Time
 */
export function getEasternDateDaysAgo(days: number): string {
  const now = new Date();
  now.setDate(now.getDate() - days);
  const formatter = new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now);
}

/**
 * Get start of week (Monday) in Eastern Time
 */
export function getEasternWeekStart(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  now.setDate(diff);
  const formatter = new Intl.DateTimeFormat('en-CA', { 
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(now);
}
