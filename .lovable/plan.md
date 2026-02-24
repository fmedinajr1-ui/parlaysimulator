

## Filter Out Underperforming Categories

### Problem
`ELITE_REB_OVER` (41.7% hit rate) and `VOLUME_SCORER` (46.9% hit rate) are dragging down overall pipeline accuracy.

### Changes

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

1. **Add to BLOCKED_CATEGORIES set** (line ~422): Add `'ELITE_REB_OVER'` and `'VOLUME_SCORER'` to the existing blocked set. This immediately prevents them from being used in any parlay leg.

2. **Remove VOLUME_SCORER from archetype strategies** (lines ~276-278, ~316-317, ~398-399): Update the `preferCategories` arrays in the `winning_archetype_3pt_scorer` strategies from `['THREE_POINT_SHOOTER', 'VOLUME_SCORER']` to just `['THREE_POINT_SHOOTER']`. There are 6 strategy entries referencing this combo across the exploration, validation, and execution tiers.

3. **Remove from FALLBACK_ARCHETYPE_CATEGORIES** (line ~20): Remove `'VOLUME_SCORER'` from the fallback list so it's not used when dynamic archetype detection finds no winners.

**File: `supabase/functions/category-props-analyzer/index.ts`**

4. **Deactivate ELITE_REB_OVER from OPTIMAL_WINNER_CATEGORIES** (line ~1880): Remove it from the array so the analyzer stops treating it as an optimal winner path.

**File: `src/hooks/useOversParlayBuilder.ts`**

5. **Replace VOLUME_SCORER in the Overs Parlay Builder** (lines ~24-29, ~129, ~162): Replace `'VOLUME_SCORER'` with `'STAR_FLOOR_OVER'` (or another scoring category with a better hit rate) so the UI parlay builder still has a scorer archetype without using the underperforming one.

### Technical Details

- The `BLOCKED_CATEGORIES` set is checked in `canUsePickGlobally()` (line ~2226), which gates every pick before it enters any parlay. Adding to this set is the single most effective filter.
- There's also a dynamic auto-block system (line ~2991) that blocks categories below 40% hit rate with 10+ samples. `VOLUME_SCORER` at 46.9% escapes this threshold, which is why a manual block is needed.
- The `category-props-analyzer` will still generate these picks for historical tracking, but they won't enter the parlay pipeline.

