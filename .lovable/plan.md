

# Add NHL Optimal Combo + Ceiling Shot Strategies

## Current State
- `nhl-floor-lock-daily` orchestrator builds only one strategy: a 4-5 leg floor lock parlay from NHL picks with 100% L10 hit rate
- The NBA side already has `optimal_combo`, `floor_lock`, and `ceiling_shot` strategies in `bot-generate-daily-parlays` but these only target `basketball_nba` or `all` sports -- NHL picks can slip in via `all` but there are no dedicated NHL-only profiles
- The `broadcast-new-strategies` function filters for `floor_lock`, `optimal_combo`, `ceiling_shot` strategy names but doesn't include NHL-specific variants

## Plan

### 1. Extend `nhl-floor-lock-daily` to build all 3 NHL strategies

After the existing floor lock parlay build (Phase 2), add two new phases:

**Phase 2B: NHL Optimal Combo**
- Query `category_sweet_spots` for NHL picks with >= 70% L10 hit rate (execution) and >= 60% (exploration)
- Enumerate all valid 3-leg combinations, score by product of individual hit rates
- Deduplicate by player, enforce max 4 same category
- Pick top 3 non-overlapping combos
- Insert to `bot_daily_parlays` with strategy `nhl_optimal_combo` (one execution, two exploration)

**Phase 2C: NHL Ceiling Shot**
- Query `category_sweet_spots` for NHL picks where `l10_max >= actual_line * 1.3`
- Target alt lines near ceiling with odds >= -130, or standard line if `l10_max >= line * 1.5`
- Build 3-leg parlays preferring plus-money odds
- Insert with strategy `nhl_ceiling_shot`

### 2. Update Telegram broadcast in Phase 3

Extend the existing Phase 3 to format and send all three strategy types in a single consolidated message:
- 🔒 Floor Lock section (existing)
- 🎯 Optimal Combo section (new)  
- 🚀 Ceiling Shot section (new)

### 3. Update `broadcast-new-strategies`

Add `nhl_optimal_combo` and `nhl_ceiling_shot` to the strategy name filter so these are included in the daily broadcast to customers.

### Files Changed
1. `supabase/functions/nhl-floor-lock-daily/index.ts` — add optimal combo + ceiling shot builders after floor lock, consolidated broadcast
2. `supabase/functions/broadcast-new-strategies/index.ts` — add NHL strategy names to filter

### Technical Details

**Optimal Combo combinatorial logic** (mirrors NBA implementation):
```typescript
function buildNHLOptimalCombos(candidates, legCount, minHitRate) {
  const combos = [];
  // C(n, legCount) enumeration
  for (let i = 0; i < candidates.length; i++)
    for (let j = i+1; j < candidates.length; j++)
      for (let k = j+1; k < candidates.length; k++) {
        const combo = [candidates[i], candidates[j], candidates[k]];
        // No same player, max 4 same category
        if (new Set(combo.map(c => c.player_name)).size < legCount) continue;
        const prob = combo.reduce((a, c) => a * c.actual_hit_rate, 1);
        if (combo.every(c => c.actual_hit_rate >= minHitRate))
          combos.push({ combo, prob });
      }
  return combos.sort((a, b) => b.prob - a.prob);
}
```

**Ceiling Shot selection** (mirrors NBA implementation):
- Filter: `l10_max >= actual_line * 1.3` AND `actual_hit_rate >= 0.45`
- Prefer picks where ceiling is 50%+ above line for bigger upside
- Build 3-leg parlays, tag with `nhl_ceiling_shot`

No database changes needed — uses existing `category_sweet_spots` and `bot_daily_parlays` tables.

