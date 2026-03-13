

## Plan: Unblock Generation to Reach 25+ Parlays

### Three Bottlenecks Identified

**1. `maxPlayerUsage: 1` blocks player reuse across parlays within a tier**
At line 3424-3427, `canUsePickGlobally` checks `tracker.playerUsageCount` against `tierConfig.maxPlayerUsage` (which is `1` for all three tiers). This means if "VJ Edgecombe" appears in one parlay, he's blocked from ALL other parlays in that tier — even for different prop types. This contradicts the user's approved exposure model (allow same player in multiple parlays via different prop categories, cap at 3 per specific player+prop+side).

**Fix:** Increase `maxPlayerUsage` to `5` for all tiers (lines 684, 878, 957). The global `player|prop|side` cap of 3 already prevents over-concentration. The player usage cap should be generous enough to allow a player to appear across different prop types.

**2. Deterministic sorting produces duplicate parlays**
Execution and validation profiles mostly use `hit_rate` or `composite` sorting, producing the exact same top-3 picks every run. Fingerprint dedup then kills all but the first. The shuffle logic (line 7839-7849) only activates for `exploration` tier or `sortBy: 'shuffle'` profiles.

**Fix:** Add a light shuffle to ALL tiers — shuffle the top 30% of candidates before greedy selection, regardless of tier. This preserves quality (top picks stay in the pool) while introducing enough variation for fingerprint uniqueness.

**3. Source verification gate starves execution/validation**
Line 7749-7752 blocks `line_source === 'projected'` picks from execution/validation. Sweet spot picks derived from median edge engine get `line_source: 'projected'` when `hasRealLine` is false. This filters out a large portion of the pool.

**Fix:** Relax the source gate for execution/validation to also allow `'verified'` source picks (which are sweet spots with real lines). The `'projected'` block is correct for execution, but many sweet spots are being tagged as `'projected'` when they actually have lines from unified_props. This needs investigation — if most sweet spots are `'projected'`, then the execution tier is essentially only using mispriced/whale/multi-engine picks, not sweet spots.

### Changes

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

1. **Line 684, 878, 957**: Change `maxPlayerUsage: 1` → `maxPlayerUsage: 5` in all three tier configs
2. **Lines 7839-7849**: Extend the shuffle logic to apply a light top-30% shuffle for ALL tiers (not just exploration), ensuring deterministic sort profiles still produce varied output across runs
3. **Line 6626**: Update `MAX_GLOBAL_PLAYER_PROP_USAGE` constant from `1` to `3` to match actual cap

### After Deploy
- Void today's pending parlays
- Regenerate fresh
- Run diversity rebalance
- Verify 25+ pending with no player+prop+side exceeding 3

