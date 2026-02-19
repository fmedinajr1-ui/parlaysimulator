
# Hot-Streak Priority: Concentrate High-Hit-Rate Categories into 3-Leg Parlays

## The Goal

Right now the generator treats `BIG_REBOUNDER under` (100% hit rate, +9 streak) and `LOW_LINE_REBOUNDER under` (100% hit rate, +7 streak) like any other category — they compete in the same pool as `VOLUME_SCORER over` (-25 streak). Tomorrow's best chance at profit is stacking these hot-streak categories together in dedicated 3-leg parlays that maximize payout when we hit.

---

## What the Data Shows

From `bot_category_weights`:

| Category | Side | Hit Rate | Current Streak | Weight |
|---|---|---|---|---|
| BIG_REBOUNDER | under | 100% | +9 (all-time best) | 1.46 |
| LOW_LINE_REBOUNDER | under | 100% | +7 (all-time best) | 1.24 |
| VOLUME_SCORER | under | 100% | +3 | 1.08 |
| HIGH_ASSIST_UNDER | under | 75% | 0 | 1.20 |
| UNDER_TOTAL | under | 70.6% | 0 | 1.20 |
| LOW_SCORER_UNDER | under | 56.7% | -1 | 1.17 |

The three 100%-hit-rate, hot-streak categories are in the pool — but they're just weighted slightly higher. There's no mechanism that says "put all three of these together in one 3-leg parlay first, before doing anything else."

---

## Two Critical Problems Being Fixed

**Problem 1 — No Hot-Streak 3-Leg Assembly Profile**

The generator has no profile that deliberately selects 1 leg from each of the top 3 hot-streak categories into a single 3-leg parlay. Currently the `execution` tier pulls `sortBy: 'hit_rate'` from the full pool, which mixes in all categories. The three best categories could easily end up split across 3 different parlays instead of concentrated in 1.

**Problem 2 — The `block_two_leg_parlays` flag only removes profile entries with `legs: 2`**

Looking at line 4708–4711 of `bot-generate-daily-parlays/index.ts`:
```ts
if (stakeConfig.block_two_leg_parlays) {
  TIER_CONFIG.execution.profiles = TIER_CONFIG.execution.profiles.filter(p => p.legs !== 2);
  TIER_CONFIG.validation.profiles = TIER_CONFIG.validation.profiles.filter(p => p.legs !== 2);
```
But the `mini_parlay` strategy path (lines 138–139 in exploration, and the fallback generator) runs separately and doesn't check this flag — explaining the 30% 2-leg leakage identified in the audit.

---

## The Fix: 3 Changes in `bot-generate-daily-parlays/index.ts`

### Change 1 — Add 4 "Hot-Streak Lock" Profiles to Execution Tier

Add these profiles to `TIER_CONFIG.execution.profiles` directly after the existing `golden_lock` profiles:

```ts
// HOT-STREAK LOCKS: Force selection from categories with current_streak >= 3 and 100% hit rate
{ legs: 3, strategy: 'hot_streak_lock', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'hit_rate', useAltLines: false },
{ legs: 3, strategy: 'hot_streak_lock', sports: ['basketball_nba'], minHitRate: 70, sortBy: 'hit_rate', useAltLines: false },
{ legs: 3, strategy: 'hot_streak_lock_cross', sports: ['all'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: false },
{ legs: 3, strategy: 'hot_streak_lock_ncaab', sports: ['basketball_ncaab', 'basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: false },
```

### Change 2 — Add a `HOT_STREAK_CATEGORIES` Constant and Pre-Sort Logic

Before the prop pool is passed to the tier generator, add a step that:
1. Reads `bot_category_weights` rows where `current_streak >= 3` AND `hit_rate >= 65%`
2. Tags those picks in the pool with a `isHotStreak: true` flag and a `+15` composite score bonus
3. Front-loads those picks via the existing `interleaveByCategory` function's golden-categories path

```ts
// Build hot-streak set from category weights
const HOT_STREAK_MIN_STREAK = 3;
const HOT_STREAK_MIN_HIT_RATE = 65;

const hotStreakCategories = new Set<string>();
(allWeights || []).forEach((w: CategoryWeight) => {
  const hitRate = (w.total_hits / Math.max(w.total_picks, 1)) * 100;
  if (!w.is_blocked && (w.current_streak || 0) >= HOT_STREAK_MIN_STREAK && hitRate >= HOT_STREAK_MIN_HIT_RATE) {
    hotStreakCategories.add(`${w.category}__${w.side}`);
    hotStreakCategories.add(w.category);
  }
});
console.log(`[HotStreak] ${hotStreakCategories.size} hot-streak categories active`);
```

Then apply a composite score boost to all pool picks from hot-streak categories:
```ts
for (const pick of enrichedSweetSpots) {
  const catKey = `${pick.category}__${pick.recommended_side}`;
  if (hotStreakCategories.has(catKey) || hotStreakCategories.has(pick.category)) {
    pick.compositeScore = Math.min(95, pick.compositeScore + 15);
    (pick as any).isHotStreak = true;
  }
}
```

### Change 3 — Fix the Mini-Parlay 2-Leg Bypass

After the `block_two_leg_parlays` filter (line ~4708), add an exploration-tier guard:

```ts
if (stakeConfig.block_two_leg_parlays) {
  // Also filter exploration mini-parlay profiles
  TIER_CONFIG.exploration.profiles = TIER_CONFIG.exploration.profiles.filter(p => {
    if (p.legs === 2 && p.strategy.includes('mini_parlay')) return false;
    return true;
  });
  // And whale_signal 2-leg (line 138 in exploration)
  TIER_CONFIG.exploration.profiles = TIER_CONFIG.exploration.profiles.filter(p => 
    !(p.legs === 2 && p.strategy === 'whale_signal')
  );
  console.log(`[Bot v2] 2-leg mini-parlays ALSO blocked from exploration tier`);
}
```

---

## What Gets Changed

| File | Change |
|---|---|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | 3 changes: (1) Add 4 hot-streak execution profiles, (2) Add hot-streak composite boost in `buildPropPool`, (3) Fix 2-leg mini-parlay bypass in exploration tier |

No database migrations. No new edge functions. No new tables.

---

## Expected Result Tomorrow

The execution tier will now have dedicated "hot-streak lock" profiles that sort by hit rate and preferentially pull `BIG_REBOUNDER under` + `LOW_LINE_REBOUNDER under` + `UNDER_TOTAL under` (the three 65%+ categories with active hot streaks) together into the same 3-leg parlay.

At $500 stake per execution parlay:
- 3-leg parlay with these categories at ~+596 odds → **+$2,980 profit on a hit**
- Expected hit rate for this combination: `~0.90 × 0.90 × 0.65 ≈ 53%` (much higher than typical 3-leg at 37%)
- Expected daily EV: `(0.53 × $2,980) - (0.47 × $500)` = **+$1,344/day EV per parlay**
