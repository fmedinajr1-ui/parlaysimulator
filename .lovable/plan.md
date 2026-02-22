

## Verified-Source-Only Engine: Kill Untagged Legs, 2x Double-Confirmed, 4x Mispriced

### The Problem

Yesterday, 38% of all legs had no verified source tag (drawn from the general `sweetSpots` pool). These untagged legs hit at only 40%, dragging down overall performance. Meanwhile:
- **Double-confirmed** legs: 9/9 (100%) but only 9 legs total
- **Mispriced edge** legs: 8/8 (100%) but only 8 legs total
- The pick pools are deep enough to support much more (200+ sweet spots, 130+ ELITE/HIGH mispriced lines)

### What Changes

**Change 1: Replace untagged exploration profiles with verified-source profiles**

The exploration tier currently has ~15 "generic" profiles (`explore_safe`, `explore_mixed`, `explore_balanced`, `explore_aggressive`, `explore_longshot`) that draw from the unverified `sweetSpots` pool. Replace most of them with `mispriced_edge` and `double_confirmed_conviction` profiles:

Remove these 10 generic profiles (lines 70-84):
```text
explore_safe (3 profiles)
explore_mixed (2 profiles) 
explore_balanced (3 profiles)
explore_aggressive (3 profiles)
explore_longshot (2 profiles)
```

Replace with 10 verified-source profiles:
```text
mispriced_edge x5: NBA(2), MLB(1), NHL(1), all(1) -- 3-leg
double_confirmed_conviction x5: all(2), NBA(2), NBA+MLB(1) -- 3-leg
```

Keep the specialized profiles (NCAAB unders, team totals, cross-sport, tennis, props, whale, nighttime) since those serve specific niches.

**Change 2: Double the double-confirmed profiles in validation tier**

Currently 3 double-confirmed profiles in validation. Add 3 more:
```text
{ legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate' }
{ legs: 3, strategy: 'double_confirmed_conviction', sports: ['all'], minHitRate: 55, sortBy: 'composite' }
{ legs: 3, strategy: 'double_confirmed_conviction', sports: ['basketball_nba', 'baseball_mlb'], minHitRate: 60, sortBy: 'hit_rate' }
```

Replace 3 of the weaker `validated_standard` / `validated_balanced` profiles that draw from the unverified pool.

**Change 3: Add more mispriced_edge to execution tier**

Currently 4 mispriced_edge profiles in execution. Add 2 more (replace the 5-leg profile which is structurally weaker):
```text
{ legs: 3, strategy: 'mispriced_edge', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate' }
{ legs: 3, strategy: 'mispriced_edge', sports: ['all'], minHitRate: 58, sortBy: 'composite' }
```
Remove the 5-leg mispriced_edge profile (line 248) -- same structural problem as master_parlay.

**Change 4: Add a source verification gate for remaining sweetSpots profiles**

In the default candidate selection path (the `else` branch at line 4537), add a filter that requires picks to have a `line_source` of `verified`, `unified_props`, `whale_signal`, `double_confirmed`, or `mispriced_edge`. Block picks with `line_source` of `projected` or `synthetic_dry_run` from execution and validation tiers. This ensures even the "generic" profiles only use picks that have been cross-referenced against real market data.

### Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Double-confirmed legs/day | ~9 | ~20-25 |
| Mispriced edge legs/day | ~8 | ~20-25 |
| Untagged/unverified legs/day | ~35 (40% hit rate) | ~5-10 (niche profiles only) |
| Projected daily hits | ~20 | ~30-35 |

### Technical Details

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

1. **Lines 70-84**: Remove 10 generic explore profiles, replace with 5 `mispriced_edge` + 5 `double_confirmed_conviction` profiles (3-leg each)

2. **Lines 165-176**: Replace 3 `validated_standard`/`validated_balanced` profiles with 3 additional `double_confirmed_conviction` profiles

3. **Line 248**: Replace 5-leg `mispriced_edge` with 2 new 3-leg mispriced profiles (NBA hit_rate + all composite)

4. **Lines 4537-4543**: Add source verification gate to the default `sweetSpots` candidate path:
```typescript
} else {
  candidatePicks = pool.sweetSpots.filter(p => {
    if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
    // SOURCE VERIFICATION GATE: execution/validation require verified sources
    if (tier !== 'exploration') {
      const source = (p as any).line_source || 'projected';
      if (source === 'projected' || source === 'synthetic_dry_run') return false;
    }
    if (sportFilter.includes('all')) return true;
    return sportFilter.includes(p.sport || 'basketball_nba');
  });
}
```

### Profile Count Summary (After Changes)

| Strategy | Exploration | Validation | Execution | Total |
|----------|------------|------------|-----------|-------|
| double_confirmed | 8 (+5) | 6 (+3) | 5 (same) | **19** (was 11) |
| mispriced_edge | 10 (+5) | 3 (same) | 5 (+1) | **18** (was 12) |
| Generic/untagged | ~35 (-10) | ~12 (-3) | ~15 (same, but source-gated) | **~62** (was ~75) |

### Files Modified

1. `supabase/functions/bot-generate-daily-parlays/index.ts` -- Profile redistribution + source verification gate

### Risk Mitigation

- Exploration tier keeps team totals, cross-sport, tennis, NCAAB, and props profiles to maintain diversity
- Source gate only applies to execution/validation tiers (exploration can still experiment with unverified picks)
- If double-confirmed pool is thin on a given day, those profiles gracefully skip (existing behavior)
- No structural changes to the parlay building engine -- only profile redistribution and an input filter

