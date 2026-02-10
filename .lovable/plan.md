

# Fix: Dashboard Date Mismatch (UTC vs EST) + Trigger Injury Data

## Problem

The `/bot` dashboard fetches parlays using UTC date (`new Date().toISOString().split('T')[0]`), which after 7 PM EST shows tomorrow's date (Feb 10) instead of today (Feb 9). This means you're seeing stale parlays from the old batch, not the fresh diversified ones.

Additionally, `lineup_alerts` is empty so the availability gate can't block injured/inactive players during generation.

## Verified: Haliburton is NOT in any parlay

Searched all data sources -- `unified_props`, `category_sweet_spots`, `bot_daily_parlays` legs for both Feb 9 and Feb 10. Haliburton does not appear anywhere. He exists only in static reference lists (star player blocks, archetype configs) that don't generate picks. The confusion is likely from the dashboard showing the wrong date's parlays or from a different page entirely.

## Fix 1: EST-aware date in dashboard query

**File: `src/hooks/useBotEngine.ts`** (line 352)

Replace:
```text
const today = new Date().toISOString().split('T')[0];
```

With a DST-aware Eastern Time calculation:
```text
const now = new Date();
const estFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const today = estFormatter.format(now);
```

This uses the same DST-aware pattern already used in the bot generator (per memory: "DST-aware Eastern Time offset via Intl.DateTimeFormat").

## Fix 2: Trigger lineup scraper + regenerate

After deploying the dashboard fix:

1. Trigger `firecrawl-lineup-scraper` with `{"sport": "basketball_nba"}` to populate injury data
2. Trigger `bot-generate-daily-parlays` with `{"date": "2026-02-09"}` to regenerate with injury filtering active
3. Verify the dashboard now shows Feb 9 parlays with only active players

## Expected Result

- Dashboard correctly shows EST-date parlays (Feb 9 while you're in Florida at night)
- Fresh parlays exclude any injured/inactive players
- Category diversity is maintained across tiers
