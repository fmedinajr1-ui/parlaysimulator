

# Smart Stack Sweet Spot Parlays — Remove Redundant Filters

## Problem
The sweet spot engine already applies rigorous quality filtering (L10 hit rates, archetype scoring, confidence thresholds). But the parlay generator applies **3 additional layers of filtering** that kill the pool from ~500 picks down to ~6:

1. **`has_real_line` gate** (line 4290): Requires every sweet spot pick to have a matching entry in `unified_props` (live sportsbook odds). Only ~13 of 500 sweet spots match. This is the **primary bottleneck**.
2. **Redundant hit rate gates** in profiles (65-75%): The sweet spot engine already filters for quality — re-filtering is unnecessary.
3. **Odds range filter** (-200 to +200): Drops picks with heavy juice that may still be valid sweet spots.

## Solution

### Step 1: Remove `has_real_line` requirement for sweet spot picks

In the enrichment filter at line 4290, stop requiring `has_real_line` for sweet spot picks. The sweet spot engine provides its own `recommended_line` and `actual_line` — these are sufficient. Use default odds (-110/-110) when sportsbook odds aren't available.

This alone should expand the pool from ~13 to ~200+ picks.

### Step 2: Lower the `sweet_spot_core` profile hit rate to 55%

Since the sweet spot engine already filters for quality (most picks are 60-100% L10), drop the profile `minHitRate` to 55% to stop redundantly filtering. The engine's own confidence scoring is the quality gate.

Update the 20 `sweet_spot_core` profile entries (lines 879-898) to use `minHitRate: 55` instead of 65/70/75. Keep sort variations (hit_rate, composite, shuffle) for diversity.

### Step 3: Increase sweet spot profile count for volume

Add more `sweet_spot_core` profiles with different sort strategies to generate 30-40+ unique parlays from the larger pool. Add profiles sorted by:
- `env_cluster` (SHOOTOUT-first, then GRIND-first) for smart stacking
- `composite` with different sport combos

Target: 30 sweet_spot_core + 10 sweet_spot_plus profiles.

### Step 4: Boost environment cluster coherence scoring for smart stacking

The cluster stacking logic already exists (SHOOTOUT/GRIND classification + coherence bonuses). Increase the coherence bonus from +12 to +20 for all-same-cluster parlays, and increase the mixed-cluster penalty from -15 to -25. This makes the parlay builder strongly prefer environment-coherent stacks without filtering — it just ranks them higher.

### Step 5: Add a "sweet spot direct" assembly path

Add a new assembly mode for `sweet_spot_core` profiles that:
1. Groups all sweet spot picks by environment cluster (SHOOTOUT / GRIND / NEUTRAL)
2. Builds parlays from within each cluster first (smart stacking)
3. Falls back to cross-cluster only if within-cluster combinations are exhausted
4. Skips the global exposure cap for sweet spot picks (they're pre-vetted)

This ensures the 200+ pick pool generates 30-40 unique, environment-coherent parlays.

## Technical Details

**File modified:** `supabase/functions/bot-generate-daily-parlays/index.ts`

**Key changes:**
- Line 4290: Split filter — sweet spots keep `has_real_line` as optional (use recommended_line fallback)
- Lines 879-898: Lower `minHitRate` from 65-75 to 55 across all sweet_spot_core profiles
- Add ~15 new sweet_spot_core profiles with env_cluster sorting
- Lines 1541-1544: Boost coherence scoring multipliers
- Lines 5981-6001: Add cluster-grouped assembly logic for sweet_spot_core

**Expected outcome:** Pool expands from ~6 to ~200+ sweet spot picks, generating 30-40 environment-coherent parlays daily.
