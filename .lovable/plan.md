

# Sweet Spot-First Parlay Architecture

## Problem
The parlay engine generates execution parlays from many different pools (mispriced, whale, team, etc.), but the Sweet Spot engine has an ~80% hit rate and is underutilized. Most execution parlays end up being `force_mispriced_conviction` or other mispriced-heavy strategies that don't leverage the Sweet Spot accuracy.

## Strategy
Make Sweet Spots the mandatory foundation of every execution parlay: **all 3 core legs must come from `category_sweet_spots`**. If any pick also passes thresholds on other engines (mispriced edge, risk engine, whale signal), it can earn a 4th bonus leg. Force-fresh mispriced-only generation becomes a conditional fallback, not a default.

## Changes

### 1. Add `sweet_spot_core` strategy profiles to execution tier
**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

Replace the majority of execution profiles with new `sweet_spot_core` profiles that:
- Draw exclusively from `pool.sweetSpots` (which is `enrichedSweetSpots` from `category_sweet_spots`)
- Require 3 legs minimum, all from sweet spots
- Sort by `hit_rate` primarily (the 80% accuracy signal)
- Minimum L10 hit rate of 70% for execution tier

New profiles (replacing ~20 mispriced/generic slots):
```
{ legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'hit_rate' }
{ legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'composite' }
{ legs: 3, strategy: 'sweet_spot_core', sports: ['all'], minHitRate: 70, sortBy: 'hit_rate' }
{ legs: 3, strategy: 'sweet_spot_core', sports: ['all'], minHitRate: 65, sortBy: 'hit_rate' }
// shuffle variants for diversity
{ legs: 3, strategy: 'sweet_spot_core', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'shuffle' }
```

### 2. Add `sweet_spot_plus` 4-leg strategy with bonus engine leg
**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

New strategy `sweet_spot_plus` that builds 4-leg parlays:
- Legs 1-3: Top sweet spots (same as `sweet_spot_core`)
- Leg 4: Best available pick from ANY other engine (mispriced, whale, risk, double-confirmed) that:
  - Is NOT already in the parlay (different player)
  - Passes a quality threshold (composite score >= 75, hit rate >= 60%)
  - Has cross-engine confirmation (appears in at least 1 other engine besides sweet spots)

This ensures the 4th leg adds value without diluting the sweet spot foundation.

### 3. Wire up `sweet_spot_core` and `sweet_spot_plus` in the candidate selection logic
**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

In the strategy routing section (around line 5980-6384), add handling for the new strategies:

```typescript
const isSweetSpotCoreProfile = profile.strategy === 'sweet_spot_core';
const isSweetSpotPlusProfile = profile.strategy === 'sweet_spot_plus';

if (isSweetSpotCoreProfile) {
  // Draw ONLY from sweet spots, filter by hit rate, sort by hit_rate or composite
  candidatePicks = pool.sweetSpots.filter(p => {
    if (BLOCKED_SPORTS.includes(p.sport || 'basketball_nba')) return false;
    if (!sportFilter.includes('all') && !sportFilter.includes(p.sport || 'basketball_nba')) return false;
    const hr = p.l10_hit_rate || p.confidence_score || 0;
    const hrPct = hr <= 1 ? hr * 100 : hr;
    return hrPct >= (profile.minHitRate || 70);
  }).sort((a, b) => {
    if (profile.sortBy === 'hit_rate') {
      const aHr = a.l10_hit_rate || 0;
      const bHr = b.l10_hit_rate || 0;
      return bHr - aHr;
    }
    return b.compositeScore - a.compositeScore;
  });
}
```

For `sweet_spot_plus`, build the first 3 legs from sweet spots, then append bonus candidates from other pools (mispriced, whale, multi-engine) with quality gates.

### 4. Make `bot-force-fresh-parlays` conditional in the orchestrator
**File:** `supabase/functions/data-pipeline-orchestrator/index.ts`

Change force-fresh from unconditional to conditional:
- After `bot-quality-regen-loop` completes, count execution-tier parlays
- Only run `bot-force-fresh-parlays` if execution count is below 8
- In mid-day regen (Phase 3B), also make force-fresh conditional

```typescript
// Count execution parlays after quality loop
const { count: execCount } = await supabase
  .from('bot_daily_parlays')
  .select('*', { count: 'exact', head: true })
  .eq('parlay_date', today)
  .eq('outcome', 'pending')
  .not('strategy_name', 'ilike', '%force_mispriced%');

if ((execCount || 0) < 8) {
  console.log(`[Pipeline] Only ${execCount} non-mispriced parlays, running force-fresh as fallback`);
  await runFunction('bot-force-fresh-parlays', {});
} else {
  console.log(`[Pipeline] ${execCount} quality parlays generated, skipping force-fresh`);
}
```

### 5. Add Sweet Spot alignment gate to `bot-force-fresh-parlays`
**File:** `supabase/functions/bot-force-fresh-parlays/index.ts`

For any force-fresh parlays that do get generated, add a Sweet Spot cross-check:
- Fetch today's sweet spot lookup (player + prop + side)
- Reject any leg that conflicts with a sweet spot recommendation (opposite side)
- Prefer legs that ARE in the sweet spot pool
- Log alignment rate

### 6. Rebalance execution tier profile counts
**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

Current execution profiles (~70 slots): heavy on mispriced_edge, god_mode_lock, golden_lock, etc.

New distribution:
| Strategy | Slots | Purpose |
|----------|-------|---------|
| sweet_spot_core | 20 | Primary 3-leg sweet spot parlays |
| sweet_spot_plus | 8 | 4-leg with bonus engine leg |
| double_confirmed_conviction | 6 | Keep (already sweet spot + mispriced cross) |
| triple_confirmed_conviction | 2 | Keep (highest conviction) |
| god_mode_lock | 6 | Keep (intersection of all signals) |
| role_stacked_3leg | 2 | Keep |
| mixed_conviction_stack | 3 | Keep |
| Other (cash_lock, boosted, golden, team, etc.) | ~20 | Reduced from current |

This ensures 28 of ~67 execution profiles (42%) are sweet-spot-first, up from 0% currently.

## Summary
- All 3 core legs in most execution parlays will come from the 80%-accurate Sweet Spot engine
- Optional 4th leg from other engines only if it passes quality gates
- Force-fresh mispriced becomes a fallback, not the default
- No sweet spot accuracy is wasted on the bench

