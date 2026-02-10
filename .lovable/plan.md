
# Fix "Proj: 0" for Unmatched Sweet Spot Players

## Problem

Players like Julian Champagnie and Stephon Castle show **"Proj: 0"** in bot parlays because their `category_sweet_spots` entries have `projected_value = NULL` and `actual_line = NULL`.

## Root Cause

The `category-props-analyzer` builds a lookup map from `unified_props` using the raw `prop_type` as-is (e.g., `player_rebounds`, `player_points`). But sweet spots use simplified prop types (`rebounds`, `points`). When the first matching entry in `unified_props` uses the `player_` prefixed variant, a second entry with the unprefixed variant may exist but the map already has a key for that player/prop -- just under a different key format.

The lookup at validation time uses `{player_name}_{prop_type}` where `prop_type` comes from the category config (e.g., `rebounds`), but the map may only have `{player_name}_player_rebounds`. Result: no match, so `actual_line` and `projected_value` stay null.

When the bot parlay builder reads these entries, it does `pick.projected_value || 0`, resulting in "Proj: 0".

## Fix (2 changes)

### 1. Normalize prop types in `category-props-analyzer` lookup map

In the `actualLineMap` builder (around line 1191), strip the `player_` prefix so both `player_rebounds` and `rebounds` resolve to the same key:

```typescript
// Before
const key = `${prop.player_name.toLowerCase().trim()}_${prop.prop_type.toLowerCase()}`;

// After  
const normalizedPropType = prop.prop_type.toLowerCase().replace(/^player_/, '');
const key = `${prop.player_name.toLowerCase().trim()}_${normalizedPropType}`;
```

This ensures that `player_rebounds`, `player_points`, `player_assists`, etc. all map to `rebounds`, `points`, `assists` -- matching the category system's prop types.

### 2. Fallback projection in `bot-generate-daily-parlays`

When enriching sweet spots (line 1033), if `projected_value` is null/0, fall back to `l10_avg` instead of 0:

```typescript
// Before
const edge = (pick.projected_value || 0) - (line || 0);

// After
const projectedValue = pick.projected_value || pick.l10_avg || pick.l10_median || line || 0;
const edge = projectedValue - (line || 0);
```

Also update the leg output (line 1443):
```typescript
projected_value: playerPick.projected_value || playerPick.l10_avg || 0,
```

## Files Modified

- `supabase/functions/category-props-analyzer/index.ts` -- normalize prop type keys in actualLineMap
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- fallback projection from L10 avg

## Expected Result

- All players with game logs will get proper `projected_value` in `category_sweet_spots`
- Bot parlays will show actual projections (e.g., "Proj: 5.5") instead of "Proj: 0"
- "Verified" badges will appear for all legs that have matching sportsbook lines
