

# Add Quarter Scoring & H2H Matchup Data to War Room Cards

## Problems Identified

1. **All unders**: The `determineOptimalSide` function has strict OVER filters (CV > 0.4 skip, edge < 10% skip) that eliminate many overs, leaving mostly unders. The side logic itself is balanced, but the downstream filters disproportionately kill overs.

2. **No per-quarter scoring data**: The `WarRoomPropCard` has no quarter breakdown. The DB has a `quarter_production` JSONB column on `player_behavior_profiles` but it's empty. Game logs don't store quarter-level stats.

3. **H2H data exists but isn't surfaced**: The `matchup_history` table has per-opponent averages, hit rates, and game counts — but the War Room card doesn't display any of it.

---

## Plan

### 1. Balance Over/Under Props in War Room

**File**: `src/hooks/useDeepSweetSpots.ts`

- Relax the OVER CV filter from 0.4 → **0.55** (line ~571) — currently too aggressive, killing most scoring overs
- Relax the OVER edge minimum from `line * 0.10` → `line * 0.05` (line ~576) — 10% edge requirement is unrealistic for high-line props
- This will let more quality OVER picks through while still blocking truly inconsistent ones

### 2. Build Quarter Scoring Averages from Game Logs

**New edge function**: `get-player-quarter-profile`

Since the DB doesn't have quarter-level stats, we'll estimate quarter scoring distribution from `nba_player_game_logs`:
- Fetch L10 game logs for each player in the selected game
- Calculate per-game averages (points, assists, rebounds, threes)
- Use even distribution (avg/4 per quarter) as baseline, then apply the existing `three_pt_peak_quarters` profile data when available to weight quarters
- Also fetch `matchup_history` rows for the opponent in one query
- Return both quarter estimates and H2H data in a single response

**Response shape**:
```typescript
{
  players: {
    [playerName: string]: {
      quarterAvgs: { q1: number; q2: number; q3: number; q4: number };
      h2h: { opponent: string; avgStat: number; gamesPlayed: number; hitRateOver: number; hitRateUnder: number; } | null;
    }
  }
}
```

### 3. Add Quarter + H2H Fields to WarRoomPropData

**File**: `src/components/scout/warroom/WarRoomPropCard.tsx`

Add to `WarRoomPropData` interface:
```typescript
quarterAvgs?: { q1: number; q2: number; q3: number; q4: number };
h2hVsOpponent?: { avgStat: number; gamesPlayed: number; hitRateOver: number; hitRateUnder: number; };
```

### 4. Display Quarter Breakdown on Card

**File**: `src/components/scout/warroom/WarRoomPropCard.tsx`

Add a compact quarter scoring row between the progress bar and bottom metrics:
- Four mini columns: Q1 | Q2 | Q3 | Q4
- Each shows the estimated average for that quarter
- Highlight the peak quarter in green to show where the player scores most
- Helps users gauge if the player is likely to meet their line by a certain quarter

### 5. Display H2H Matchup on Card

**File**: `src/components/scout/warroom/WarRoomPropCard.tsx`

Add a row below the quarter breakdown:
- "vs [Opponent]: avg [X.X] in [N] games"
- Color the avg green if above the line, red if below
- Show H2H hit rate for the relevant side (over/under)

### 6. Fetch and Wire Data in WarRoomLayout

**File**: `src/components/scout/warroom/WarRoomLayout.tsx`

- Call `get-player-quarter-profile` edge function once when the game loads (pass player names + opponent)
- Merge the returned quarter avgs and H2H data into each `WarRoomPropData` in the `propCards` builder
- The H2H data from `matchup_history` already factors opponent-specific performance, improving accuracy of projections shown

### Summary

| Change | File |
|---|---|
| Relax OVER filters (CV 0.55, edge 5%) | `useDeepSweetSpots.ts` |
| New edge function for quarter + H2H data | `get-player-quarter-profile/index.ts` |
| Add quarterAvgs + h2h fields to card data | `WarRoomPropCard.tsx` |
| Render Q1-Q4 mini breakdown on card | `WarRoomPropCard.tsx` |
| Render H2H matchup row on card | `WarRoomPropCard.tsx` |
| Fetch + wire data on game load | `WarRoomLayout.tsx` |

