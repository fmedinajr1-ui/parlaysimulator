

# Fix Lottery Scanner — Sync with Updated Logic + Matchup-Aware Alt Lines

## Problem Summary

The `nba-mega-parlay-scanner` (lottery) was never updated with yesterday's fixes. It has 5 critical bugs that cause bad picks and missing data:

1. **Game logs query returns nothing** (line 217): `.eq('game_date', today)` fetches today's logs, but games haven't been played yet — L10 avg, median, position are always null
2. **`Math.abs(edge_pct)`** (line 290): Negative edges treated as positive — same bug we just fixed in the main generator
3. **Defense stats fetched but never used** (lines 219-220): Data is pulled from DB but never factors into scoring
4. **No edge direction validation**: A mispriced UNDER signal can boost an OVER prop
5. **No minimum edge guard**: Props with 0% hit rate can enter if edge is inflated by `Math.abs` bug
6. **No database persistence**: Lottery parlays aren't saved to `bot_daily_parlays`, so they can't be tracked or settled

## What's Being Added: Matchup-Aware Lottery Intelligence

Per your request, the lottery scanner will now specifically target players with **volume history** who are playing against **weak defenses** in their prop category. For example:
- Kyle Kuzma averaging 2.5 threes/game facing a team ranked 25th in 3PT defense → boost + alt line hunt
- A big man averaging 10 rebounds facing a team that allows the most rebounds → boost

The scanner will use alternate lines (via `fetch-alternate-lines`) to find better odds on these high-volume matchups, creating true "lottery ticket" parlays with informed alt line selection.

---

## Fix Plan (6 changes, 1 file)

### 1. Fix Game Logs Query (line 215-217)

Remove `.eq('game_date', today)` and instead fetch the **most recent** game logs per player without a date filter, using `.order('game_date', { ascending: false }).limit(500)`. This ensures L10 averages, medians, and position data are populated.

### 2. Remove `Math.abs` + Add 3% Edge Floor (line 290)

Change `Math.abs(ml.edge_pct || 0)` to raw `(ml.edge_pct || 0)`. Add guard: if `edgePct < 3`, treat as 0. Only count edge when the mispriced signal direction matches the prop side.

### 3. Add Edge Direction Validation (lines 293-299)

Only apply edge bonus and direction bonus when the mispriced signal matches the prop side. If mispriced says OVER but we're building an UNDER prop, edge = 0 and no direction bonus.

### 4. Integrate Defense Stats into Scoring (after line 320)

Build a defense lookup by team and stat category. For each prop:
- Identify the opponent team
- Look up their defensive rank for the relevant stat (points, rebounds, assists, threes)
- Apply a matchup multiplier:
  - Weak defense (rank 21-30): +8 to +15 composite bonus for OVER props (this is the "offensive team allowing more" signal you want)
  - Elite defense (rank 1-10): -10 penalty for OVER props, +5 bonus for UNDER props
- This directly rewards picks like "Kuzma threes OVER vs weak 3PT defense"

### 5. Add Volume History Check + Alt Line Hunting

For the top 10 candidates that have:
- L10 avg significantly above the main line (1.3x+ buffer)
- Facing a weak defense (rank 18+) in their stat category
- Positive mispriced edge >= 5%

Call `fetch-alternate-lines` to find higher alt lines with bigger plus-money odds. If an alt line exists where the player's L10 avg still clears it, swap in the alt line for a bigger payout. This creates the "increased alt + increased odds" lottery pattern.

### 6. Raise Filters + Save to Database

- Raise `MIN_HIT_RATE` from 55 to 60
- Remove the fallback that lets 0% hit rate props enter with only edge >= 15
- Require `edgePct >= 3` for qualification
- After building the parlay, insert it into `bot_daily_parlays` with `tier: 'lottery'` and `strategy: 'mega_lottery_scanner'` so it's tracked alongside regular parlays

---

## File Modified

**`supabase/functions/nba-mega-parlay-scanner/index.ts`**
- Line 217: Fix game logs query (remove date filter, use recent logs)
- Line 290: Remove `Math.abs`, add 3% edge floor
- Lines 293-299: Add direction validation for edge and bonuses
- After line 320: Add defense matchup scoring with weak/elite defense multipliers
- After line 370: Add alt line fetching for top volume+matchup candidates
- Lines 342-384: Raise filters (60% hit rate, 3% edge floor, remove 0% fallback)
- After line 457: Insert lottery parlay into `bot_daily_parlays` table

