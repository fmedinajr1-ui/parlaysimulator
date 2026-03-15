

# Add player_threes_q1 and player_steals_q1 to Q1 Coverage

## Changes

### 1. Whale Odds Scraper — Add to Q1 batch
**File**: `supabase/functions/whale-odds-scraper/index.ts` (line 32)

Add `player_threes_q1` and `player_steals_q1` to the existing Q1 batch:
```typescript
['player_points_q1', 'player_rebounds_q1', 'player_assists_q1', 'player_threes_q1', 'player_steals_q1'],
```

### 2. Edge Function — Map new Q1 prop types
**File**: `supabase/functions/get-player-quarter-profile/index.ts`

- Add to `Q1_PROP_MAP`: `player_threes_q1: 'threes'` and `player_steals_q1: 'steals'`
- Add `'threes', 'steals'` to the Q1 lines loop (line ~148) so they get included in the response
- Add the new prop types to the `unified_props` query filter (line ~79)

### 3. War Room UI — Display new Q1 lines
**File**: `src/components/scout/warroom/WarRoomPropCard.tsx`

The existing `q1FanDuelLine` display logic is generic — it will automatically show for any prop type that has Q1 data. No UI changes needed.

### Summary
| Change | File |
|---|---|
| Add 2 markets to Q1 batch | `whale-odds-scraper/index.ts` |
| Map new Q1 props + expand query filter | `get-player-quarter-profile/index.ts` |

