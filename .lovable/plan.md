

# Fix Lottery Scanner: Filter to Today's Games Only

## Problem
The `nba-mega-parlay-scanner` fetches ALL NBA events from The Odds API (line 211) without filtering by date. If the API returns tomorrow's games (e.g., Knicks), players from those games (like OG Anunoby) get included in today's lottery tickets even though they're not playing today.

There is no date/time filtering anywhere in the pipeline -- the scanner trusts whatever the API returns.

## Fix

### Filter events to today's games only (lines 211-215)

After fetching the events list from The Odds API, filter out any event whose `commence_time` is not today (Eastern Time). The API returns `commence_time` as an ISO timestamp for each event.

```text
Before:
  fetch all events -> use all of them

After:
  fetch all events -> filter to only events starting today ET -> use those
```

Add a helper that checks if an event's `commence_time` falls on today's Eastern date. Then filter `eventsList` before processing props:

1. Parse each event's `commence_time` (ISO string like `2026-03-02T23:00:00Z`)
2. Convert to Eastern Time
3. Compare the date portion to `today` (already computed as Eastern date)
4. Drop events that don't match

This is a ~10 line change in the event processing section (lines 211-215). No other changes needed -- once the events list only contains today's games, all downstream prop fetching, scoring, and ticket building automatically excludes players from non-today games.

## Technical Details

**File:** `supabase/functions/nba-mega-parlay-scanner/index.ts`

**Changes:**
- Lines 211-215: After fetching `eventsList`, add a filter that keeps only events where `commence_time` converted to Eastern date matches `today`
- Add a small helper function to convert ISO timestamp to Eastern date string (reuse the same `Intl.DateTimeFormat` pattern already used in `getEasternDate`)
- Log how many events were filtered out for transparency

**Expected result:** If the Knicks aren't playing today, their events get dropped, and no Knicks players (including OG Anunoby) appear in any lottery ticket.

