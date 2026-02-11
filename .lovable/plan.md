
# Prioritize Winning Archetypes in Bot Parlay Generation

## Current Behavior

The bot has a "Golden Categories" system that identifies archetypes with 60%+ hit rate and 20+ samples. Right now, the three golden categories are:

| Category | Hit Rate | Picks | Weight |
|----------|----------|-------|--------|
| THREE_POINT_SHOOTER | 75.3% | 214 | 1.30 |
| LOW_SCORER_UNDER | 65.4% | 60 | 1.17 |
| BIG_ASSIST_OVER | 61.7% | 65 | 1.14 |

The bot front-loads golden picks in the candidate pool via `interleaveByCategory()`, and the composite score formula gives a 1.5x multiplier to categories with 65%+ calibrated hit rates. However, when building execution-tier parlays (the real-money "cash lock" plays), the round-robin interleave still mixes in weaker categories like ROLE_PLAYER_REB (53.5%) and HIGH_ASSIST (no golden status). Meanwhile LOW_SCORER_UNDER, the #2 golden category, barely appears.

## Problem

1. Execution-tier parlays don't enforce a minimum golden-leg ratio -- they just iterate the interleaved pool in order
2. The interleave distributes category diversity equally, diluting golden categories with 50-55% hit rate ones
3. No sorting by category weight within the candidate selection loop

## Proposed Fix

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

### Change 1: Sort candidates by category weight for execution tier

In `generateTierParlays()` (around line 1532), after the sport/bet-type filtering but before the candidate loop, add weight-based re-sorting for the execution tier. When `sortBy` is not explicitly `hit_rate`, sort candidates by their category weight descending (from `bot_category_weights`), then by composite score as tiebreaker. This ensures the highest-winning archetypes are tried first.

```
// For non-hit-rate-sorted profiles, sort by category weight descending
if (profile.sortBy !== 'hit_rate' && tier === 'execution') {
  candidatePicks = [...candidatePicks].sort((a, b) => {
    const aWeight = weightMap.get(a.category) || 1.0;
    const bWeight = weightMap.get(b.category) || 1.0;
    if (bWeight !== aWeight) return bWeight - aWeight;
    return (b.compositeScore || 0) - (a.compositeScore || 0);
  });
}
```

### Change 2: Enforce minimum golden legs in execution parlays

After a parlay is fully built (around line 1645, before the fingerprint check), add a golden-leg ratio check for execution-tier parlays. At least 50% of legs (rounded down) must come from golden categories. If not, skip the parlay.

```
// Execution tier: require at least half the legs from golden categories
if (tier === 'execution') {
  const goldenLegCount = legs.filter(l => goldenCategories.has(l.category)).length;
  const minGoldenLegs = Math.floor(profile.legs / 2);
  if (goldenLegCount < minGoldenLegs) {
    console.log(`[Bot] Skipping ${tier}/${profile.strategy}: only ${goldenLegCount}/${profile.legs} golden legs (need ${minGoldenLegs})`);
    continue;
  }
}
```

This requires passing `goldenCategories` into `generateTierParlays()` as a parameter.

### Change 3: Pass goldenCategories to generateTierParlays

Update the function signature to accept the golden categories set, and pass it from the caller (around line 1480 where the function is invoked).

## Impact

- Execution parlays will heavily favor THREE_POINT_SHOOTER (75.3%), LOW_SCORER_UNDER (65.4%), and BIG_ASSIST_OVER (61.7%)
- Exploration and validation tiers are unchanged -- they keep discovering new patterns
- As categories earn/lose golden status through calibration, the bot automatically adapts
- No database changes required

## Technical Details

- Three insertions in `supabase/functions/bot-generate-daily-parlays/index.ts`
- One function signature update (add `goldenCategories: Set<string>` parameter)
- One caller update to pass the set through
- Edge function will be redeployed automatically
