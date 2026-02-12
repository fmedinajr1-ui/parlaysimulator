

# Execution Tier: 3-Leg Focus + Smart Side Flipping for Losing Categories

## The Problem

Feb 11 showed that 4-5 leg execution parlays are fragile -- a single "poison" category kills the whole bet. All 4 winners that day were 3-leg builds. Meanwhile, categories like VOLUME_SCORER (53% over) are penalized but never actually flipped to their winning side (under).

## What Changes

### 1. Cap Execution Tier at 3 Legs Max

The current execution tier has 4-leg and 5-leg profiles that dilute win probability. We'll replace them with more 3-leg variants focused on golden categories.

**Current execution profiles (10 total):**
- 3x 3-leg profiles
- 4x 4-leg profiles  
- 2x 5-leg profiles
- 1x 4-leg cross-sport

**New execution profiles (10 total):**
- 6x 3-leg profiles (cash locks, boosted, cross-sport)
- 4x 4-leg profiles moved to validation tier (they become "proving ground" builds)

### 2. Smart Side Flipping (Not Blocking)

Instead of blocking losing categories, the generator will **auto-flip them to the winning side**. The data already supports this:

| Category | Over Hit Rate | Under Hit Rate | Action |
|---|---|---|---|
| VOLUME_SCORER | 53.1% (128 picks) | Untested | Flip to under, weight 1.10 |
| ROLE_PLAYER_REB | 53.5% (176 picks) | Untested | Flip to under, weight 1.10 |
| LOW_LINE_REBOUNDER | 39.1% (40 picks) | Untested | Flip to under, weight 1.00 |

The generator already uses side-aware weight keys (`VOLUME_SCORER__under`). We need to make the **category-props-analyzer** actually generate "under" sweet spots for these categories, so the generator has under-side candidates to pick from.

### 3. Enable Golden Gate for Execution

The `ENFORCE_GOLDEN_GATE` flag (line 1683) is currently `false`. We'll enable it for execution tier only, requiring at least 50% of legs to come from golden categories (60%+ hit rate, 20+ samples). Current golden categories:
- THREE_POINT_SHOOTER (75.3%, 214 picks)
- HIGH_ASSIST_UNDER (75%, 12 picks)
- LOW_SCORER_UNDER (65.4%, 60 picks)
- ASSIST_ANCHOR under (63.6%, 18 picks)
- BIG_ASSIST_OVER (61.7%, 65 picks)

---

## Technical Details

### Generator Changes (`bot-generate-daily-parlays/index.ts`)

**Execution profiles** -- replace lines 168-182:
```typescript
profiles: [
  // ALL 3-LEG: Maximum win probability
  { legs: 3, strategy: 'cash_lock', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: false },
  { legs: 3, strategy: 'cash_lock', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: false },
  { legs: 3, strategy: 'cash_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
  { legs: 3, strategy: 'cash_lock_cross', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
  { legs: 3, strategy: 'boosted_cash', sports: ['basketball_nba'], minHitRate: 65, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
  { legs: 3, strategy: 'boosted_cash', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.5 },
  { legs: 3, strategy: 'boosted_cash_cross', sports: ['all'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: true, boostLegs: 1, minBufferMultiplier: 1.2 },
  { legs: 3, strategy: 'golden_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
  { legs: 3, strategy: 'golden_lock', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false },
  { legs: 3, strategy: 'golden_lock_cross', sports: ['all'], minHitRate: 58, sortBy: 'hit_rate', useAltLines: false },
],
```

**Move 4-5 leg profiles to validation tier** -- add them to the validation profiles array so they still get tested but aren't in the "cash" tier.

**Enable golden gate** -- change `ENFORCE_GOLDEN_GATE` from `false` to `true` (line 1683).

### Category Analyzer Changes (`category-props-analyzer/index.ts`)

Add auto-flip logic: when a category's "over" hit rate drops below 50% with 30+ samples, generate "under" sweet spots for it instead. This feeds the generator with under-side candidates for VOLUME_SCORER, ROLE_PLAYER_REB, and LOW_LINE_REBOUNDER.

### Database Updates

Update `bot_category_weights` to properly reflect the flip strategy:
- VOLUME_SCORER over: keep weight 0.50 (deprioritized, not blocked)
- VOLUME_SCORER under: weight 1.10 (promoted)
- Same pattern for ROLE_PLAYER_REB and LOW_LINE_REBOUNDER

These weight entries already exist from the previous flipping work -- no schema changes needed.

### Summary of File Changes

1. **`supabase/functions/bot-generate-daily-parlays/index.ts`** -- Replace execution profiles with all-3-leg builds, move 4-5 leg to validation, enable golden gate
2. **`supabase/functions/category-props-analyzer/index.ts`** -- Add auto-flip logic for underperforming over categories
3. **Database** -- No migration needed, existing weight rows support this

