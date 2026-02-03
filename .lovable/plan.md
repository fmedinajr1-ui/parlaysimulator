
# Populate All Star Players with Shot Chart Data

## Problem Identified

The `fetch-shot-chart-data` edge function currently has a `LIMIT 150` constraint (line 56) when fetching active players from `bdl_player_cache`. This arbitrary limit prevents many star players from getting zone statistics populated.

**Current State:**
- 468 active players in `bdl_player_cache`
- Only 153 unique players have zone stats (first 150 + duplicates)
- Star players missing: LeBron James, Stephen Curry, Jayson Tatum, Joel Embiid, Anthony Edwards, Giannis Antetokounmpo, Kevin Durant (all ARE in the cache but beyond the 150 limit)
- Star players present: Shai Gilgeous-Alexander, Nikola Jokic, Luka Doncic

---

## Solution

Update the edge function to remove the artificial limit and process ALL active players. Also add batching support to handle larger datasets efficiently.

---

## Changes Required

**Modify: `supabase/functions/fetch-shot-chart-data/index.ts`**

### Change 1: Remove the LIMIT 150 restriction

```typescript
// Before (line 52-56):
const { data: activePlayers, error: playersError } = await supabase
  .from('bdl_player_cache')
  .select('player_name, team_name')
  .eq('is_active', true)
  .limit(150);

// After:
const { data: activePlayers, error: playersError } = await supabase
  .from('bdl_player_cache')
  .select('player_name, team_name')
  .eq('is_active', true);
```

### Change 2: Add pagination if dataset is large (optional but recommended)

For safety, add request body support to allow processing in batches if needed:

```typescript
// Parse optional offset/limit from request body
const body = await req.json().catch(() => ({}));
const offset = body.offset ?? 0;
const limit = body.limit ?? 500; // Default to 500, max reasonable per call

const { data: activePlayers } = await supabase
  .from('bdl_player_cache')
  .select('player_name, team_name')
  .eq('is_active', true)
  .range(offset, offset + limit - 1);
```

### Change 3: Add logging for visibility

```typescript
console.log(`Processing players ${offset} to ${offset + activePlayers.length}`);
```

---

## Implementation Summary

| File | Change |
|------|--------|
| `supabase/functions/fetch-shot-chart-data/index.ts` | Remove LIMIT 150, add optional pagination support |

---

## Expected Results After Implementation

1. **Run edge function once** - All 468 active players will be processed
2. **Zone stats populated** - ~2,340 records (468 players x 5 zones)
3. **All star players included** - LeBron, Curry, KD, Giannis, Tatum, Embiid, Edwards will have shot chart data
4. **Shot Chart Preview visible** - All Points/3PM props will show pre-game matchup visualization

---

## Post-Deployment Testing

After deploying the updated function:
1. Call `POST /fetch-shot-chart-data` with no body to process all players
2. Verify with: `SELECT COUNT(DISTINCT player_name) FROM player_zone_stats` (should be ~468)
3. Confirm star players: `SELECT * FROM player_zone_stats WHERE player_name = 'LeBron James'`
4. Navigate to Sweet Spots page and verify Shot Chart Preview appears for Points/3PM props
