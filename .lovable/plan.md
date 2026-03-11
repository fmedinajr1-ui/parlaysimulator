

## Fix: Normalize `threes` / `player_threes` Prop Type Split

### Problem
When legs flow into `bot_player_performance`, prop types like `threes`, `player_threes`, `three_pointers`, and `3pm` are stored as separate records. A player can be a "proven winner" on `player_threes` while simultaneously being flagged as a "serial loser" on `threes` — or vice versa. The same split affects `points`/`player_points`, `rebounds`/`player_rebounds`, `assists`/`player_assists`, etc.

### Solution
Add a `normalizePropType()` utility function that maps all variant prop type strings to a single canonical form. Apply it at every point where prop types are used as keys.

**Canonical mapping:**
```text
player_points, points, pts       → player_points
player_rebounds, rebounds, reb    → player_rebounds
player_assists, assists, ast     → player_assists
player_threes, threes, 3pm, three_pointers → player_threes
player_blocks, blocks, blk       → player_blocks
player_steals, steals, stl       → player_steals
player_turnovers, turnovers, to  → player_turnovers
```

### Files to Change

**1. `supabase/functions/bot-settle-and-learn/index.ts`**
- Add `normalizePropType()` function
- Line ~1112: Normalize `propType` before building the `playerKey` and `propTypePerfUpdates` key
- This ensures settlement writes a single canonical record per player+prop

**2. `supabase/functions/bot-update-engine-hit-rates/index.ts`**
- Add same `normalizePropType()` function
- Line ~219: Normalize `leg.prop_type` before building the player stats key
- Ensures the full-rebuild path also produces canonical records

**3. `supabase/functions/bot-generate-daily-parlays/index.ts`**
- Add same `normalizePropType()` function
- Line ~1133: Normalize `p.prop_type` when building the lookup map key
- Line ~1149: Normalize `propType` in `getPlayerBonus()` 
- Line ~1170: Normalize in `isGodModePick()`
- Ensures reads match the canonical keys written by settlement

### Data Cleanup
After deploying, run a one-time merge of existing split records in `bot_player_performance` — combining `threes` rows into their `player_threes` counterparts (summing legs_played/legs_won, recalculating hit_rate, keeping the most recent streak).

### No Schema Changes Required
The `prop_type` column remains a text field. We're just normalizing the values written to it.

