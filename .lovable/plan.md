

# Add FanDuel Q1 Props + Use for Hedge Recommendations

## What We're Building

1. **Scrape FanDuel Q1 player props** from The Odds API (`player_points_q1`, `player_rebounds_q1`, `player_assists_q1`)
2. **Display Q1 FanDuel lines** on War Room prop cards alongside the estimated quarter averages
3. **Use Q1 lines in hedging logic** — compare live Q1 production against the FanDuel Q1 line to give early hedge signals

## Changes

### 1. Whale Odds Scraper — Add Q1 Prop Markets

**File**: `supabase/functions/whale-odds-scraper/index.ts`

Add a 4th batch to `PLAYER_MARKET_BATCHES['basketball_nba']`:
```typescript
['player_points_q1', 'player_rebounds_q1', 'player_assists_q1'],
```

These will be scraped and stored in `unified_props` with `prop_type` values like `player_points_q1`. No schema changes needed — they flow through existing upsert logic.

### 2. Edge Function — Return Q1 FanDuel Lines

**File**: `supabase/functions/get-player-quarter-profile/index.ts`

After fetching game logs and matchup data, also query `unified_props` for today's Q1 props:
```sql
SELECT player_name, prop_type, current_line, over_price, under_price 
FROM unified_props 
WHERE prop_type IN ('player_points_q1','player_rebounds_q1','player_assists_q1')
  AND bookmaker = 'fanduel'
  AND scraped_at > now() - interval '6 hours'
```

Map `player_points_q1` → `points`, etc., and add to the response per player:
```typescript
q1Lines: { points?: { line: number; overPrice: number; underPrice: number } }
```

### 3. War Room Prop Card — Show Q1 FanDuel Line

**File**: `src/components/scout/warroom/WarRoomPropCard.tsx`

- Add `q1FanDuelLine?: { line: number; overPrice: number; underPrice: number }` to `WarRoomPropData`
- In the `QuarterBreakdown` component, show the FanDuel Q1 line next to Q1 avg:
  - e.g., "Q1: 6.2 avg | FD: O/U 5.5 (-110)" 
  - Color green if Q1 avg > FD line (value on over), red if below

### 4. Wire Q1 Lines in WarRoomLayout

**File**: `src/components/scout/warroom/WarRoomLayout.tsx`

Map the new `q1Lines` data from the edge function response into each prop card's `q1FanDuelLine` field.

### 5. Hedge Logic — Early Q1 Signal

**File**: `src/lib/hedgeStatusUtils.ts`

Add Q1-aware hedge acceleration in `calculateHedgeStatus`:
- When `gameProgress < 25` (Q1) and Q1 FanDuel line data is available:
  - If player already **exceeds** the Q1 line in Q1 → boost confidence (shift toward `on_track`)
  - If player is **well below** Q1 line pace in Q1 → accelerate toward `monitor` or `alert` earlier than default thresholds
- This gives users a 1st-quarter early warning based on real FanDuel market data rather than just estimated averages

### Summary

| Change | File |
|---|---|
| Add Q1 prop market batch | `whale-odds-scraper/index.ts` |
| Fetch & return Q1 FanDuel lines | `get-player-quarter-profile/index.ts` |
| Display Q1 FD line on card | `WarRoomPropCard.tsx` |
| Wire Q1 data to cards | `WarRoomLayout.tsx` |
| Q1-aware hedge early signal | `hedgeStatusUtils.ts` |

