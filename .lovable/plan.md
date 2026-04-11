

# Fix: MMA Props Not Showing — Data Lives in `game_bets`, Analyzer Reads `unified_props`

## Root Cause

The `mma-rounds-analyzer` queries `unified_props` for MMA data, but MMA props are never written there. The whale-odds-scraper writes MMA totals to `game_bets` (bet_type = "total") with over_odds/under_odds. Today's data confirms this: there are UFC fights with round totals in `game_bets` (e.g., Prado vs Radtke, O/U 1.5 rounds at -220/+170) but zero rows in `unified_props` for any MMA sport key.

This is the exact same gap that affected tennis — the analyzer was built to read from `unified_props` but no sync pipeline exists to get `game_bets` MMA totals into that table.

## Fix

### 1. Create `mma-props-sync` edge function
Same pattern as `tennis-props-sync` — bridges MMA total rounds from `game_bets` into `unified_props`:
- Query `game_bets` where `sport = 'mma'` and `bet_type = 'total'` with today's commence_time
- For each row, upsert into `unified_props` with:
  - `sport` = `'mma_mixed_martial_arts'`
  - `player_name` = `"Fighter A vs Fighter B"` (from home_team/away_team)
  - `prop_type` = `'total_rounds'`
  - `current_line` = the line (e.g., 1.5)
  - `over_price` / `under_price` from over_odds/under_odds
  - `bookmaker`, `event_id` = game_id, `commence_time`
- Upsert keyed on event_id + prop_type + bookmaker to avoid duplicates

### 2. Update `morning-prep-pipeline`
Add `mma-props-sync` before `mma-rounds-analyzer` (same pattern as tennis-props-sync → tennis-games-analyzer):
- Step 4.7a: `mma-props-sync`
- Step 4.7b: `mma-rounds-analyzer` (already exists)

### 3. Deploy and test
- Deploy `mma-props-sync`
- Run it to sync today's fights
- Run `mma-rounds-analyzer` to verify it now finds props and generates picks

## Files

| File | Action |
|------|--------|
| `supabase/functions/mma-props-sync/index.ts` | **Create** — sync MMA totals from game_bets → unified_props |
| `supabase/functions/morning-prep-pipeline/index.ts` | **Edit** — add mma-props-sync before mma-rounds-analyzer |

