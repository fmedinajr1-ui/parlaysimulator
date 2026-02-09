
# Fix: Remove Inactive Players from Telegram + Clean Up Bad Parlays

## Root Causes

### 1. Old pre-fix parlays still in database
There are **44 parlays** for Feb 9 - 40 were generated BEFORE the availability gate was implemented. These contain Kawhi Leonard, Joel Embiid, Collin Gillespie, Jimmy Butler III, Klay Thompson, Stephen Curry (no game today), etc. The Telegram `/parlays` command shows ALL of them.

### 2. No injury data for today
`lineup_alerts` has zero entries for Feb 9. The cron jobs were just scheduled but haven't run yet. Even with the availability gate, the injury blocklist is empty.

### 3. DST detection bug in the availability gate
`getEasternDateRange()` uses `now.getTimezoneOffset()` to detect EDT vs EST, but on a UTC server this value is always 0, making the comparison meaningless. The offset calculation defaults to EST (UTC-5) which may be wrong during daylight saving time.

### 4. Generator doesn't clean up old parlays
When `/generate` is called multiple times in a day, new parlays are appended without removing stale ones from earlier runs that may have used an unfiltered pool.

## Solution

### Part 1: Fix `bot-generate-daily-parlays/index.ts`

**Fix DST detection** - Replace the broken `getTimezoneOffset()` approach with a reliable method that checks the actual ET offset by formatting a date in both ET and UTC and comparing:

```text
function getEasternDateRange() {
  const now = new Date();
  // Get ET date string
  const etDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
  
  // Reliable DST check: compare ET hour vs UTC hour
  const etHour = parseInt(new Intl.DateTimeFormat('en-US', { 
    timeZone: 'America/New_York', hour: 'numeric', hour12: false 
  }).format(now));
  const utcHour = now.getUTCHours();
  const etOffset = (utcHour - etHour + 24) % 24; // 5 for EST, 4 for EDT
  
  // Noon ET in UTC
  const [year, month, day] = etDate.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, day, 12 + etOffset, 0, 0));
  const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
  
  return { startUtc: startDate.toISOString(), endUtc: endDate.toISOString(), gameDate: etDate };
}
```

**Add cleanup before generation** - Before inserting new parlays, delete any existing parlays for the same date that were generated from a previous run. This prevents stale/bad parlays from accumulating:

```text
// In the main handler, before saving new parlays:
await supabase.from('bot_daily_parlays')
  .delete()
  .eq('parlay_date', targetDate)
  .eq('outcome', 'pending');
```

### Part 2: Fix `telegram-webhook/index.ts`

Update `getParlays()` to only show the most recent generation batch (by `created_at`), not all parlays for the day. This way even if cleanup doesn't run, users only see the latest filtered set.

### Part 3: Immediate cleanup

- Delete the 40 bad pre-fix parlays from Feb 9 (keep only the 4 clean ones from 21:04 UTC)
- Run the injury scraper immediately to populate today's `lineup_alerts`
- Re-generate parlays with fresh injury data

## Technical Details

### File changes

**`supabase/functions/bot-generate-daily-parlays/index.ts`**:
- Fix `getEasternDateRange()` DST logic (lines 534-565): Replace `getTimezoneOffset()` with `Intl.DateTimeFormat` hour comparison
- Add cleanup of old pending parlays before inserting new ones (in the main handler, before the save step)

**`supabase/functions/telegram-webhook/index.ts`**:
- Update `getParlays()` (lines 112-141): After fetching all parlays for today, group by `created_at` and only return parlays from the latest generation batch

### Database cleanup (one-time)
- Delete bot_daily_parlays where parlay_date = '2026-02-09' AND created_at < '2026-02-09T21:00:00Z' (the 40 bad parlays)

### Execution sequence
1. Deploy both function fixes
2. Clean up bad parlays from database
3. Trigger `firecrawl-lineup-scraper` for fresh injury data
4. Trigger `bot-generate-daily-parlays` for a clean generation with availability gate + injury data
5. Verify via `/parlays` on Telegram that only active, healthy players appear
