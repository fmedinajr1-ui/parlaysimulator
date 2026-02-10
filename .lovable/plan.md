

# Fix: Date Alignment and Prop Type Mismatches

## Root Causes Found

There are **3 distinct bugs** causing the entire pipeline to break:

### Bug 1: Prop Type Mismatch (Frontend picks always empty)
- `unified_props` table stores prop types as `player_threes`, `player_assists`
- `useTodayProps` hook queries with `threes`, `assists`
- Result: **0 active players found, every time** -- picks page always shows empty

### Bug 2: Field Name Mismatch (Verification never triggers from post-game refresh)
- `refresh-sweet-spots-post-game` calls verify with `{ targetDate: todayET }`
- `verify-sweet-spot-outcomes` reads `body.date`
- Result: verification always falls back to "yesterday" instead of the intended date

### Bug 3: Feb 9 Picks Never Verified
- 300 sweet spots for Feb 9 are still "pending"
- 211 game logs exist for Feb 9 -- data is there
- 51 parlays from Feb 9 can't settle because the picks they reference aren't graded yet

## Fix Plan

### Step 1: Fix `useTodayProps.ts` -- prop type mapping
Update the `PROP_CONFIG` to use the correct `unified_props` prop types:
- `threes` config: change `propType` from `'threes'` to `'player_threes'`
- `assists` config: change `propType` from `'assists'` to `'player_assists'`

### Step 2: Fix `refresh-sweet-spots-post-game/index.ts` -- field name
Change the invoke body from `{ targetDate: todayET }` to `{ date: todayET }` so `verify-sweet-spot-outcomes` actually receives the correct date.

### Step 3: Fix `bot-settle-and-learn/index.ts` -- add verification step
Add a call to `verify-sweet-spot-outcomes` at the beginning of the settlement run, BEFORE reading outcomes. This ensures:
- Sweet spots get graded against game logs first
- Then parlays can be settled using the freshly graded picks
- The pipeline becomes self-healing instead of depending on a separate cron

### Step 4: Manual test run
After deploying all fixes:
1. Trigger `verify-sweet-spot-outcomes` for Feb 9 to grade the 300 pending picks
2. Trigger `bot-settle-and-learn` to settle the 51 pending parlays
3. Verify the Telegram settlement report is sent

## Files Changed
- `src/hooks/useTodayProps.ts` -- fix prop type strings in PROP_CONFIG
- `supabase/functions/refresh-sweet-spots-post-game/index.ts` -- fix field name (`targetDate` to `date`)
- `supabase/functions/bot-settle-and-learn/index.ts` -- add verification call before settlement

