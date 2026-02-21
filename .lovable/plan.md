

## Fix Parlay Settlement for Feb 19 and Feb 20

### Root Cause

The `bot-settle-and-learn` function settles player prop legs by looking up the leg's `id` in the `category_sweet_spots` table. However, the parlay generation engine (`bot-generate-daily-parlays`) assigns leg IDs that **do not match** the `category_sweet_spots` IDs in several cases:

1. **Master parlays** (`master_parlay_*` strategies) -- the builder at line 5695 creates legs **without an `id` field** at all
2. **Some execution strategies** generate new UUIDs instead of preserving the original sweet spot ID

For example, a parlay leg for "Devin Booker Over 1.5 Threes" has ID `78d2e1ed...`, but the actual `category_sweet_spots` row is `3058f61e...`. The ID lookup returns nothing, so every player leg stays `pending` forever.

**Current state:**
- Feb 19: 17 pending parlays (10 already settled as lost)
- Feb 20: 52 pending parlays
- `category_sweet_spots` for both dates are fully verified (112 hit / 74 miss for Feb 19, 67 hit / 32 miss for Feb 20)

### Fix: Add Fallback Lookup by Player Name + Prop Type + Line

When the ID-based lookup fails (returns no match from `sweetSpotMap`), the settlement function should fall back to querying `category_sweet_spots` by:
- `player_name` (normalized)
- `prop_type`
- `recommended_line` = leg's `line`
- `analysis_date` = parlay's `parlay_date`
- `outcome` is not `pending`

This guarantees legs get settled even when IDs don't match.

### Changes

**File: `supabase/functions/bot-settle-and-learn/index.ts`**

1. After the batch `sweetSpotMap` lookup (line 630-648), add a **fallback query function** that searches `category_sweet_spots` by player name + prop type + line + date when the ID lookup misses.

2. In the per-leg settlement loop (lines 696-709), when `sweetSpotMap.get(leg.id)` returns nothing, call the fallback:
   - Query `category_sweet_spots` WHERE `player_name ILIKE` normalized name AND `prop_type = leg.prop_type` AND `recommended_line = leg.line` AND `analysis_date = parlay.parlay_date` AND `outcome != 'pending'`
   - If a match is found, use its `outcome` and `actual_value`
   - Log the fallback match for debugging

3. As a second fallback when even the name+prop lookup fails, **directly query `nba_player_game_logs`** for the player on the game date and resolve the leg using the same `extractStatValue` logic from `verify-sweet-spot-outcomes`.

### Technical Details

**Fallback priority order:**
```text
1. sweetSpotMap.get(leg.id)          -- exact ID match (current behavior)
2. category_sweet_spots query        -- name + prop_type + line + date
3. nba_player_game_logs direct query -- raw stat lookup as last resort
```

**Prop type to column mapping for direct game log lookup:**
```text
threes     -> threes_made
points     -> points
rebounds   -> rebounds
assists    -> assists
blocks     -> blocks
steals     -> steals
pra        -> points + rebounds + assists
pr         -> points + rebounds
pa         -> points + assists
ra         -> rebounds + assists
```

**After the code fix, trigger settlement:**
- Call `bot-settle-and-learn` with `{ "date": "2026-02-19", "force": true }`
- Call `bot-settle-and-learn` with `{ "date": "2026-02-20", "force": true }`

This will re-process all 69 pending parlays and settle them using the fallback lookups.

