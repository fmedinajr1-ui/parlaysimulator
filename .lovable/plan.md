

# Floor & Ceiling Parlay Tiers

## Concept
Two new parlay tiers that use actual L10 game log data (floor = `l10_min`, ceiling = `l10_max`) to intelligently shop alternate lines:

- **Safe/Floor parlays**: Use the player's L10 floor as the target line. Example: De'Aaron Fox's worst game in L10 had 7 assists → take Over 6.5 at the standard line. The floor *exceeds* the line, meaning even his worst night covers.
- **Ceiling/Risky parlays**: Find an alt line near the player's L10 ceiling (best game). Example: Fox hit 14 assists as his best in L10 → shop for Over 11.5 or 12.5 at plus-money odds. High upside, lower probability.

## Changes

### 1. Extend `SweetSpotPick` interface
Add `l10_min`, `l10_max`, `l10_avg`, `l10_median` fields so floor/ceiling data flows through the enrichment pipeline.

### 2. New `selectFloorLine` function
For safe parlays: picks the standard line **only if** `l10_min >= line` (floor clears the line). No alt line shopping needed — the safety IS the floor guarantee.

### 3. New `selectCeilingLine` function  
For ceiling parlays: searches alternate lines for one near the player's `l10_max` (within 1-2 steps). Must have **plus-money odds** (> +100). Uses an 8-game lookback ceiling (`l8_max` computed from L10 data excluding the 2 oldest games) to be more recent-biased.

### 4. New strategy profiles in `TIER_CONFIG`

**Execution tier** (safe/floor):
- `floor_lock` — 3-leg, all legs must have `l10_min >= line`, 70%+ hit rate, standard lines only
- Sorts by floor margin (how far floor exceeds line)

**Exploration tier** (ceiling/risky):  
- `ceiling_shot` — 3-leg, all legs use ceiling alt lines at plus-money, creates lottery-style tickets
- Sorts by ceiling upside (how far ceiling exceeds alt line)

### 5. Strategy filtering in parlay assembly
- `floor_lock`: During candidate filtering, block any pick where `l10_min < line` (floor doesn't clear)
- `ceiling_shot`: During candidate filtering, require `l10_max >= line * 1.3` (ceiling must be 30%+ above standard line). In leg assembly, call `selectCeilingLine` to find the highest viable alt line with plus-money odds.

### Files Changed
1. `supabase/functions/bot-generate-daily-parlays/index.ts`:
   - Extend `SweetSpotPick` with `l10_min`, `l10_max`, `l10_avg`, `l10_median`
   - Add `selectFloorLine()` and `selectCeilingLine()` functions
   - Add `floor_lock` and `ceiling_shot` strategy profiles to execution + exploration tiers
   - Add strategy-specific candidate filtering in the parlay assembly loop
   - Label parlays with `🔒 FLOOR LOCK` / `🎯 CEILING SHOT` in `selection_rationale`

