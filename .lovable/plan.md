

# PP Whale Proxy (No NFL) - Implementation Plan

## Overview

Create a single-page real-time sharp signal detector that ingests PrizePicks prop snapshots, compares against book consensus lines, and auto-dispenses picks with confidence grades (A/B/C) based on a computed SharpScore.

---

## Database Schema

### 4 New Tables

| Table | Purpose |
|-------|---------|
| `pp_snapshot` | Store PrizePicks prop line snapshots |
| `book_snapshot` | Store sportsbook consensus lines |
| `whale_signals` | Detected sharp signals (STEAM/DIVERGENCE/FREEZE) |
| `whale_picks` | Auto-dispensed picks with confidence grades |

### Table Definitions

**pp_snapshot**
- `id` (uuid, PK)
- `market_key` (text) - composite key: `{sport}_{league}_{event_id}_{player}_{stat_type}_{period}`
- `sport` (text) - NBA, WNBA, MLB, NHL, TENNIS
- `league` (text) - e.g., ATP, WTA, MLB
- `event_id` (text)
- `player_name` (text)
- `stat_type` (text) - e.g., points, rebounds, strikeouts
- `period` (text) - FULL_GAME, 1H, SET_1, etc.
- `pp_line` (numeric)
- `is_active` (boolean)
- `start_time` (timestamptz)
- `matchup` (text)
- `captured_at` (timestamptz)

**book_snapshot**
- `id` (uuid, PK)
- `market_key` (text, FK reference)
- `consensus_line` (numeric)
- `sample_size` (int) - number of books in consensus
- `captured_at` (timestamptz)

**whale_signals**
- `id` (uuid, PK)
- `market_key` (text)
- `signal_type` (text) - STEAM, DIVERGENCE, FREEZE
- `sharp_score` (int, 0-100)
- `divergence_score` (int, 0-40)
- `move_speed_score` (int, 0-25)
- `confirmation_score` (int, 0-20)
- `board_behavior_score` (int, 0-15)
- `reasons_json` (jsonb) - array of reason strings
- `created_at` (timestamptz)

**whale_picks**
- `id` (uuid, PK)
- `market_key` (text)
- `player_name` (text)
- `matchup` (text)
- `sport` (text)
- `stat_type` (text)
- `period` (text)
- `pick_side` (text) - OVER / UNDER
- `pp_line` (numeric)
- `confidence` (text) - A, B, C
- `sharp_score` (int)
- `signal_type` (text)
- `why_short` (text[]) - max 2 bullet reasons
- `start_time` (timestamptz)
- `created_at` (timestamptz)
- `expires_at` (timestamptz)
- `is_expired` (boolean, default false)

---

## File Structure

```
src/
├── pages/
│   └── WhaleProxy.tsx                    # Main page
├── components/
│   └── whale/
│       ├── WhaleProxyDashboard.tsx       # Main dashboard component
│       ├── WhalePickCard.tsx             # Individual pick card
│       ├── WhaleWatchlistCard.tsx        # Watchlist item card
│       ├── WhaleFeedHealth.tsx           # Feed health status
│       └── WhaleFilters.tsx              # Filter controls
├── hooks/
│   └── useWhaleProxy.ts                  # Data fetching + simulation logic
└── lib/
    └── whaleUtils.ts                     # SharpScore calculation + mock data
```

---

## Component Architecture

### WhaleProxyDashboard.tsx (Main Component)

**State:**
- `selectedSport`: 'ALL' | 'NBA' | 'WNBA' | 'MLB' | 'NHL' | 'TENNIS'
- `confidenceFilter`: 'A' | 'A+B' | 'ALL'
- `timeWindow`: '15m' | '1h' | 'today'
- `isSimulating`: boolean

**Layout:**
```
[Header with title + Simulate toggle]
[Filter row: Sport | Confidence | Time Window]
[Stats row: Live Picks count | Watchlist count | Last update]

[LIVE PICKS Section]
  - Cards sorted by sharp_score DESC
  - Only shows A/B confidence picks

[WATCHLIST Section]
  - Cards sorted by sharp_score DESC
  - Shows C confidence picks (55-64)

[FEED HEALTH Section]
  - Last PP snapshot time
  - Last book snapshot time
  - Lag seconds
  - Props tracked count
  - Error count
```

### WhalePickCard.tsx

Display fields:
- Player name + matchup + start time countdown
- Stat type + period badge
- Pick side (OVER/UNDER) + PP line
- Confidence badge (A = green, B = amber, C = gray)
- Signal type tag (STEAM = blue, DIVERGENCE = orange, FREEZE = red)
- Why bullets (max 2)
- Timestamp + expires countdown

### WhaleFeedHealth.tsx

Display:
- Last PP Snapshot: "2 sec ago" / "45 sec ago" with color coding
- Last Book Snapshot: same format
- Lag Alert: shows warning if > 30 seconds
- Props Tracked: count
- Errors: count with expand for details

---

## Hook: useWhaleProxy.ts

**Queries:**
1. `useWhalePicks()` - fetch from `whale_picks` where `is_expired = false` and `start_time > now()`
2. `useWhaleSignals()` - fetch from `whale_signals` for context
3. `useFeedHealth()` - aggregate snapshot timestamps

**Simulation Mode:**
- When `isSimulating = true`, generate mock data every 10 seconds
- Use `useState` + `useEffect` with interval
- Mock data generator creates realistic prop movements

---

## SharpScore Calculation (whaleUtils.ts)

```typescript
interface SharpScoreInput {
  ppLine: number;
  consensusLine: number;
  ppLinePrevious?: number;
  minutesSinceLastChange: number;
  booksFollowedDirection: boolean;
  wasFrozen: boolean;
  wasRelisted: boolean;
}

function calculateSharpScore(input: SharpScoreInput): {
  total: number;
  divergence: number;
  moveSpeed: number;
  confirmation: number;
  boardBehavior: number;
} {
  // DivergenceScore (0-40): normalized |pp_line - consensus|
  const lineDiff = Math.abs(input.ppLine - input.consensusLine);
  const divergence = Math.min(40, lineDiff * 8);

  // MoveSpeedScore (0-25): how fast did PP line change
  const delta = input.ppLinePrevious 
    ? Math.abs(input.ppLine - input.ppLinePrevious) 
    : 0;
  const moveSpeed = Math.min(25, (delta / Math.max(1, input.minutesSinceLastChange)) * 10);

  // ConfirmationScore (0-20): books follow direction
  const confirmation = input.booksFollowedDirection ? 20 : 0;

  // BoardBehaviorScore (0-15): freeze/relist detection
  const boardBehavior = (input.wasFrozen ? 10 : 0) + (input.wasRelisted ? 5 : 0);

  return {
    total: divergence + moveSpeed + confirmation + boardBehavior,
    divergence,
    moveSpeed,
    confirmation,
    boardBehavior
  };
}

function getConfidenceGrade(sharpScore: number): 'A' | 'B' | 'C' | null {
  if (sharpScore >= 80) return 'A';
  if (sharpScore >= 65) return 'B';
  if (sharpScore >= 55) return 'C';
  return null; // Below threshold
}
```

---

## Mock Data Generator

```typescript
const MOCK_PLAYERS = {
  NBA: ['LeBron James', 'Jayson Tatum', 'Luka Doncic', 'Nikola Jokic'],
  WNBA: ['Aja Wilson', 'Breanna Stewart', 'Caitlin Clark'],
  MLB: ['Shohei Ohtani', 'Aaron Judge', 'Mookie Betts'],
  NHL: ['Connor McDavid', 'Nathan MacKinnon', 'Auston Matthews'],
  TENNIS: ['Novak Djokovic', 'Carlos Alcaraz', 'Iga Swiatek']
};

const STAT_TYPES = {
  NBA: ['points', 'rebounds', 'assists', 'threes'],
  WNBA: ['points', 'rebounds', 'assists'],
  MLB: ['strikeouts', 'hits_allowed', 'total_bases'],
  NHL: ['shots_on_goal', 'points', 'saves'],
  TENNIS: ['aces', 'games_won', 'sets_won']
};

function generateMockPick(): WhalePick {
  // Randomly generate realistic pick data
  // Assign random SharpScore 55-95
  // Create 1-2 "why" bullets based on signal type
}
```

---

## Routing

Add to `src/App.tsx`:
```typescript
const WhaleProxy = React.lazy(() => import("./pages/WhaleProxy"));

// In Routes:
<Route path="/whale-proxy" element={<WhaleProxy />} />
```

---

## UI Behavior Rules

1. **No NFL**: Filter excludes any NFL-related data
2. **Started Events**: Auto-hide picks where `start_time < now()`
3. **Deduplication**: Same market_key cannot re-issue within 15 min unless sharp_score increases by 15+
4. **Expiration**: `expires_at = min(start_time - 5min, now + 45min)`
5. **Sorting**: Always by sharp_score DESC within each section

---

## Files to Create

| File | Type |
|------|------|
| `src/pages/WhaleProxy.tsx` | Page component |
| `src/components/whale/WhaleProxyDashboard.tsx` | Main dashboard |
| `src/components/whale/WhalePickCard.tsx` | Pick card |
| `src/components/whale/WhaleWatchlistCard.tsx` | Watchlist card |
| `src/components/whale/WhaleFeedHealth.tsx` | Health monitor |
| `src/components/whale/WhaleFilters.tsx` | Filter controls |
| `src/hooks/useWhaleProxy.ts` | Data hooks |
| `src/lib/whaleUtils.ts` | Utilities + mock generator |

---

## Technical Summary

This creates a self-contained whale proxy page with:
- Mock data simulation toggle for demo/testing
- Real-time UI updates every 10 seconds when simulating
- Clean card-based feed matching existing tracker patterns
- SharpScore algorithm with transparent component scoring
- Confidence grading (A/B/C) with visual badges
- Signal type detection (STEAM/DIVERGENCE/FREEZE)
- Feed health monitoring panel
- Proper expiration and deduplication logic

The page will work immediately with simulated data, and can be connected to real PrizePicks feeds when available.

