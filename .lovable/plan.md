

# Blowup Risk Filter for UNDER Picks

## Problem
High-ceiling players like Chet Holmgren have volatile stat lines — they may average near a line but can easily explode past it in big games. Betting UNDER on these players is risky because their L10 max far exceeds the line, and their standard deviation is high. Currently, no filter blocks or penalizes UNDERs on high-variance players.

## Solution
Add a "blowup risk" gate that runs during pick validation in two key files:

### 1. `bot-generate-daily-parlays/index.ts` — Hard block + penalty

Add a `blowupRiskCheck` function near the existing `passesGodModeMatchup` (~line 280):

- **Ceiling Blowup Ratio**: `l10_max / line`. If >= 1.5 (player's ceiling is 50%+ above line), hard-block the UNDER.
- **Variance Gate**: If `l10_std_dev` (from sweet spots) is high relative to the margin (`l10_std_dev > (line - l10_avg) * 1.5`), block the UNDER — the player's variance alone can blow past the line.
- **Soft Penalty**: For borderline cases (ceiling ratio 1.25–1.5 OR std_dev > margin), apply a -15 composite score penalty to deprioritize the pick.
- Integrate this check in the main pick loop where `recommended_side === 'under'`, alongside the existing GodMode matchup check.

**Logic:**
```
if side == 'under':
  ceiling_ratio = l10_max / line
  if ceiling_ratio >= 1.5 → HARD BLOCK ("blowup risk")
  if l10_std_dev > (line - l10_avg) * 1.5 → HARD BLOCK ("high variance under")
  if ceiling_ratio >= 1.25 → -15 penalty
```

### 2. `matchup-intelligence-analyzer/index.ts` — Risk flag

Add a new risk flag `BLOWUP_CEILING_UNDER` to the `RISK_FLAGS` object (~line 85):
```
BLOWUP_CEILING_UNDER: { code: 'BLOWUP_CEIL', label: 'High Ceiling Blowup Risk', severity: 'critical', confidenceAdjustment: -12 }
```

Add the flag when analyzing UNDER picks where `l10_max / line >= 1.3`.

### 3. `nba-player-prop-risk-engine/index.ts` — Additional layer

Add blowup risk check in the risk engine's per-pick validation loop. When processing UNDER recommendations, check if the player's `l10_max` from `category_sweet_spots` (already loaded into `l10HitRateMap`) exceeds 1.4x the line, and block/penalize accordingly.

## Data Available
All needed fields already exist in `category_sweet_spots`: `l10_max`, `l10_min`, `l10_avg`, `l10_std_dev`. No schema changes needed.

## Files Changed
1. `supabase/functions/bot-generate-daily-parlays/index.ts` — Add `blowupRiskCheck()` function and integrate into pick loop
2. `supabase/functions/matchup-intelligence-analyzer/index.ts` — Add `BLOWUP_CEILING_UNDER` risk flag
3. `supabase/functions/nba-player-prop-risk-engine/index.ts` — Add blowup ceiling gate in per-pick validation

