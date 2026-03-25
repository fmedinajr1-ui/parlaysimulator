

# Enable MLB Parlay Generation

## Current State
- Historical game logs exist but stop at Feb 20 — no current season data
- FanDuel only has 24 MLB props (pitcher K's); BetMGM has 1,267
- MLB is explicitly blocked in `bot-generate-daily-parlays` and filtered out in `broadcast-new-strategies`
- The MLB game log ingestion function exists but needs to run for current dates

## Plan

### Step 1: Fix MLB game log ingestion for current season
Update the MLB data ingestion to fetch recent game logs (last 14 days) and backfill the gap from Feb 20 to today. Ensure the `mlb_player_game_logs` table has current L10 data for active players.

**File:** `supabase/functions/mlb-props-sync/index.ts` or create a dedicated `mlb-data-ingestion` function modeled after `ncaa-baseball-data-ingestion` but targeting ESPN's MLB endpoints.

### Step 2: Fix whale-odds-scraper MLB FanDuel coverage
The scraper collects MLB props but FanDuel only returns 24. Investigate whether MLB prop market keys need adjustment (similar to the NBA Q1 fix). Ensure batting props (hits, total_bases, rbis, runs, home_runs, stolen_bases) are included in MLB batches, not just pitcher_strikeouts.

**File:** `supabase/functions/whale-odds-scraper/index.ts` — review/add MLB-specific market batches

### Step 3: Unblock MLB in parlay generator
Remove the "MLB blocked" guard in `bot-generate-daily-parlays`:
- Re-enable MLB engine cross-reference boost (currently hardcoded to 0)
- Allow `baseball_mlb` sport through the generation filter

**File:** `supabase/functions/bot-generate-daily-parlays/index.ts` — lines ~6376 and ~6393

### Step 4: Unblock MLB in broadcast
Remove the `filterBaseball()` calls in `broadcast-new-strategies` that strip MLB parlays before sending to Telegram.

**File:** `supabase/functions/broadcast-new-strategies/index.ts`

### Step 5: Add MLB to scheduled pipeline
Add MLB game log refresh to the morning-data-refresh cron (8 AM ET) so L10 stats stay current daily.

**File:** `supabase/functions/refresh-l10-and-rebuild/index.ts` or the morning pipeline orchestrator

## Execution Order
1. Steps 1–2 first (data foundation)
2. Steps 3–4 (unblock generation)
3. Step 5 (automate daily refresh)
4. Test end-to-end with a manual pipeline run

