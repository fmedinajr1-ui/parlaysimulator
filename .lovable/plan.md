

# Fix MLB Parlay Generation — Unblock + Data Coverage

## Problem Summary
MLB has good analytical data (604 mispriced lines today, 49K game logs) but three hard blocks in the generator prevent any MLB pick from entering parlays, and FanDuel batting prop coverage is nearly zero (only 24 pitcher K props).

## Plan

### Step 1: Remove MLB from BLOCKED_SPORTS and BLOCKED_CATEGORIES
**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

- Remove `'baseball_mlb'` from the `BLOCKED_SPORTS` array (line 1114)
- Remove all 14 MLB categories from `BLOCKED_CATEGORIES` (lines 1124-1128): `MLB_PITCHER_K_OVER`, `MLB_HITS_OVER`, `MLB_TOTAL_BASES_OVER`, etc.

### Step 2: Uncomment MLB parlay recipes
**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

Activate the paused MLB recipes:
- Line 725: `mispriced_edge` for `baseball_mlb` (composite sort)
- Line 797-798: Two MLB `mispriced_edge` recipes
- Line 802: `double_confirmed_conviction` cross-sport NBA+MLB recipe

### Step 3: Fix FanDuel MLB prop coverage in the scraper
**File:** `supabase/functions/whale-odds-scraper/index.ts`

The Odds API uses different market key formats for MLB batting props on FanDuel vs BetMGM. Investigate and fix the MLB market batches — currently `batter_hits`, `batter_rbis`, `batter_runs_scored`, `batter_total_bases`, `batter_home_runs`, `batter_stolen_bases`, `pitcher_strikeouts`, `pitcher_outs` are used. Some of these may not be valid FanDuel market keys. Add per-market fallback (already exists for NBA) to MLB batches so invalid keys don't kill the whole batch.

### Step 4: Re-run MLB cross-reference engine
Trigger `mlb-prop-cross-reference` and `mlb-batter-analyzer` to populate today's `mlb_engine_picks` and refresh `mispriced_lines` with current data.

### Step 5: Run full pipeline and verify MLB legs appear in output
Execute `refresh-l10-and-rebuild` and confirm MLB props appear in generated parlays and Telegram broadcasts.

## Files Changed
1. `supabase/functions/bot-generate-daily-parlays/index.ts` — Remove blocks, uncomment recipes
2. `supabase/functions/whale-odds-scraper/index.ts` — Verify/fix MLB FanDuel market keys
3. No new files needed

