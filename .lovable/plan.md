

## Fix: Scanner Queries Non-Existent Column `event_id`

### Root Cause

The `game_bets` table uses `game_id`, not `event_id`. The scanner's select query on line 148 asks for `event_id`, which causes the Supabase query to return no data (or an error swallowed by the destructured response). Result: 0 games found every time.

### Changes

**File: `supabase/functions/bot-matchup-defense-scanner/index.ts`**

1. **Line 148** -- Change `event_id` to `game_id` in the `.select()` call
2. **Lines 162-164** -- Change `event_id` references to `game_id` in the deduplication logic

That's it -- two lines. The date range fix and team name mapping from the previous deploy are already correct. Once this column name is fixed, the scanner will find tonight's 11 NBA games and produce the full matchup defense map.

