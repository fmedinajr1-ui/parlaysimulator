

# Add More DNA Signals from Existing Data

## Current State

DNA has only 7 signals with enough data to produce weights. The `extractSignals` function returns 12, but 5 get filtered out due to low sample sizes or zero separation. Meanwhile, `category_sweet_spots` has **15+ unused columns** that can be turned into predictive features with zero pipeline risk.

## New Signals to Add (All Derived from Existing Columns)

These only change `analyze-pick-dna` (learning) and `score-parlays-dna` (scoring). No parlay generation changes needed.

| # | Signal | Formula | Why It Helps |
|---|--------|---------|-------------|
| 1 | `floor_vs_line` | `(l10_min - line) / line × 100` (OVER) | Does player's worst game still hit? Strong safety signal |
| 2 | `median_buffer` | `(l10_median - line) / line × 100` | Median resists outliers better than mean |
| 3 | `trend_l5_vs_l10` | `(l5_avg - l10_avg) / l10_avg × 100` | Medium-term momentum (complements L3 vs L10) |
| 4 | `consistency` | `l10_std_dev / l10_avg` | Coefficient of variation — lower = more reliable |
| 5 | `season_vs_line` | `(season_avg - line) / line × 100` | Long-term baseline buffer |
| 6 | `h2h_vs_line` | `(h2h_avg_vs_opponent - line) / line × 100` | Does player beat line against THIS opponent? |
| 7 | `games_played` | Raw `games_played` value | More data = more trustworthy pick |
| 8 | `projected_buffer` | `(projected_value - line) / line × 100` | Do projections agree with the pick? |

## What Changes

### 1. `analyze-pick-dna/index.ts`
- Add new columns to the `SettledPick` interface and SELECT query: `l5_avg`, `games_played`, `projected_value`
- Add 8 new derived signals to `extractSignals()`
- Everything else (stats computation, weight storage, Telegram report) works unchanged

### 2. `score-parlays-dna/index.ts`
- Add the same 8 computed signals to the per-leg scoring loop
- The existing `weightMap.get(signalName)` lookup auto-discovers new weights — no structural changes

### 3. `bot-generate-daily-parlays/index.ts`
- Add `games_played`, `projected_value`, `l10_min`, `l10_median`, `h2h_avg_vs_opponent` to leg JSON (same pattern as the existing stat enrichment fix)

## Why This Is Safe

- **No new tables** — uses existing columns already populated daily
- **No pipeline changes** — only touches the DNA learning/scoring layer
- **No voiding risk** — signals with insufficient data automatically get filtered by the existing `hitVals.length < 10` check
- **Self-calibrating** — if a new signal doesn't predict wins, it gets near-zero weight and is ignored

## Files Changed

1. `supabase/functions/analyze-pick-dna/index.ts` — Add 8 new derived signals
2. `supabase/functions/score-parlays-dna/index.ts` — Add same signals to scoring
3. `supabase/functions/bot-generate-daily-parlays/index.ts` — Enrich legs with missing stat fields

