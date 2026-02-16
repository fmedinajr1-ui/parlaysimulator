

# Fix: Shadow Picks Not Saving (Column Name Mismatch)

## Root Cause

The simulation engine references `game.event_id` but the `game_bets` table uses `game_id` as the column name. This means every shadow pick insert has `event_id: null`, which violates the NOT NULL constraint on `simulation_shadow_picks.event_id` -- so zero rows are saved.

## Changes

### 1. Fix `supabase/functions/odds-simulation-engine/index.ts`

- Update the `GameBet` interface: rename `event_id` to `game_id`
- Update all references from `game.event_id` to `game.game_id` throughout the file (shadow pick construction, duplicate-check keys, settle mode event lookups)
- In the shadow pick insert object, map `event_id: game.game_id`

### 2. Fix settle mode lookup

The settle mode queries `game_bets` by `event_id` which doesn't exist. Change it to query by `game_id` instead, and match shadow picks' `event_id` field against `game_bets.game_id`.

### 3. Make `event_id` nullable (database migration)

As a safety measure, alter `simulation_shadow_picks.event_id` to be nullable with a default of empty string, so a missing game_id doesn't silently block all inserts. Alternatively, keep it NOT NULL but the code fix above should resolve the issue.

**Recommendation**: Keep NOT NULL -- the code fix is the right solution.

## Files Modified
- `supabase/functions/odds-simulation-engine/index.ts` -- fix `event_id` -> `game_id` mapping

## No Database Changes Needed
The `simulation_shadow_picks.event_id` column is fine as NOT NULL. The fix is purely in the edge function code.

