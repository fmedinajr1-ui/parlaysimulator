

# Fix Sweet Spot Pipeline: Activate Picks and Sync Projections

## Problem Summary

Two critical issues are blocking the bot from generating parlays today:

1. **All 300 category_sweet_spots picks are `is_active: false`** - The analyzer matched only 22 players to live lines (out of 300) because it uses `commence_time >= now()` which misses games that already tipped or are about to start. The other 278 were marked inactive.

2. **unified_props are unenriched** - All 2,061 live lines have `composite_score: 0`, `category: uncategorized`, and `true_line: null`. Projections from category_sweet_spots aren't synced back.

Additionally, several picks in the top 10 have **negative edges** (projection goes against the recommended side), which means the bot would bet on losing positions.

## Fix Plan

### Step 1: Re-activate valid sweet spots with edge validation

Write a quick SQL update to set `is_active = true` on category_sweet_spots rows that:
- Have `actual_line IS NOT NULL` (matched to a real sportsbook line)
- Have a **positive directional edge** (projection supports the recommended side)
- Have `l10_hit_rate >= 0.70`

This filters out bad picks like LaMelo Assists OVER 8.5 (proj only 7.5) while activating good ones like Donovan Mitchell Assists OVER 5.5 (proj 7.0, 100% L10 hit rate).

### Step 2: Sync projections into unified_props

Update the `category-props-analyzer` to write projection data back to `unified_props` after analysis. This means updating:
- `true_line` = projected_value from category_sweet_spots
- `true_line_diff` = projected_value - current_line
- `composite_score` = confidence_score from sweet spots
- `category` = category from sweet spots
- `recommended_side` = from sweet spots

This is a new sync step at the end of the analyzer function that joins on `player_name` + `prop_type` (normalized).

### Step 3: Fix the `commence_time` filter in the analyzer

Change the analyzer's unified_props query from:
```
.gte('commence_time', nowIso)
```
to a wider window that includes today's games even if they've already started:
```
.gte('commence_time', todayStartUtc)  // Start of today in UTC
```

This ensures games that tipped off 30 minutes ago still get their players matched.

### Step 4: Add negative-edge blocking

Add validation in the analyzer so picks with projections that contradict the recommended side are automatically blocked:
- OVER picks: require `projected_value > actual_line`
- UNDER picks: require `projected_value < actual_line`

This prevents the bot from ever recommending LaMelo Assists OVER 8.5 when the projection is only 7.5.

## Technical Changes

### Files Modified

1. **`supabase/functions/category-props-analyzer/index.ts`**
   - Fix `commence_time` filter (line ~1161): use start-of-day UTC instead of `now()`
   - Add negative-edge blocking after projection calculation (around line 1304)
   - Add unified_props sync step at end of function (new ~50 lines)

2. **Database migration**: No schema changes needed -- `unified_props` already has `true_line`, `true_line_diff`, `composite_score`, `category`, `recommended_side` columns

### Estimated impact
- Activates ~15-20 valid sweet spot picks for today (from current 0)
- Enriches ~200-400 unified_props rows with projections and categories
- Blocks ~5-8 negative-edge picks that would have hurt parlay accuracy

