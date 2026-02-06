
# Block Star Players from ALL UNDER Picks

## Problem
Star players like **Anthony Edwards**, **Luka Doncic**, and other ball-dominant superstars are still potentially being recommended for UNDER picks in Sweet Spots. The current protections (28+ minute filter, archetype blocks) help but don't explicitly block by player name.

The solution: **Never recommend UNDER on star players**. If they're producing below pace during a live game, the **Hedge Recommendation** system will alert users to consider an UNDER hedge at that time.

---

## Solution: Add Explicit Star Player Block

### 1. Add Star Player List to Category-Props-Analyzer

Add the same `BALL_DOMINANT_STARS` and `ALL_STAR_PLAYERS` lists from the risk engine:

```typescript
// ============ STAR PLAYER BLOCK (v7.1) ============
// Never recommend UNDER on star players - hedge system will handle live
const STAR_PLAYER_NAMES = [
  // Ball-Dominant Stars
  'luka doncic', 'luka dončić',
  'anthony edwards',
  'shai gilgeous-alexander', 'shai gilgeous alexander',
  'jayson tatum', 'giannis antetokounmpo',
  'nikola jokic', 'nikola jokić',
  'ja morant', 'trae young', 'damian lillard',
  'kyrie irving', 'donovan mitchell',
  'de\'aaron fox', 'deaaron fox',
  'tyrese haliburton', 'lamelo ball',
  'kevin durant', 'lebron james',
  'stephen curry', 'joel embiid',
  'devin booker', 'jaylen brown',
  'anthony davis', 'jalen brunson',
  'tyrese maxey', 'jimmy butler',
  'karl-anthony towns', 'paolo banchero',
  'zion williamson', 'victor wembanyama',
];

function isStarPlayer(playerName: string): boolean {
  const normalized = playerName.toLowerCase().trim();
  return STAR_PLAYER_NAMES.some(star => 
    normalized.includes(star) || star.includes(normalized)
  );
}
```

### 2. Add Star Block Check in Processing Loop

In the category processing loop, add an explicit star player check **before** the archetype validation:

```typescript
// v7.1: STAR PLAYER BLOCK - Never recommend UNDER on stars
// If they're slow during live game, hedge system will alert
if (config.side === 'under' && isStarPlayer(playerName)) {
  console.log(`[Category Analyzer] ⭐ STAR BLOCKED: ${playerName} excluded from ${catKey} - use hedge system for live adjustments`);
  blockedByStarStatus++;
  continue;
}
```

### 3. Add Star Block to useDeepSweetSpots.ts

Add the same star player check in the client-side hook as a backup:

```typescript
// v7.1: STAR PLAYER BLOCK - Never generate UNDER for star players
const STAR_PLAYERS = [
  'luka doncic', 'anthony edwards', 'shai gilgeous-alexander',
  'jayson tatum', 'giannis antetokounmpo', 'nikola jokic',
  // ... (same list)
];

function isStarPlayer(name: string): boolean {
  const normalized = name.toLowerCase().trim();
  return STAR_PLAYERS.some(star => normalized.includes(star));
}

// In determineOptimalSide:
function determineOptimalSide(
  l10Stats: L10Stats, 
  line: number, 
  production?: ProductionMetrics,
  playerName?: string  // NEW: Pass player name
): PickSide {
  // v7.1: STAR PLAYER BLOCK - Always OVER for stars
  if (playerName && isStarPlayer(playerName)) {
    console.log(`[DeepSweetSpots] ⭐ Star player ${playerName}: forcing OVER`);
    return 'over';
  }
  // ... existing logic
}
```

---

## Technical Details

### Files to Modify

1. **`supabase/functions/category-props-analyzer/index.ts`**
   - Add `STAR_PLAYER_NAMES` constant (lines ~106)
   - Add `isStarPlayer()` function
   - Add star block check in processing loop (before line 790)
   - Track `blockedByStarStatus` counter for logging

2. **`src/hooks/useDeepSweetSpots.ts`**
   - Add `STAR_PLAYERS` constant
   - Add `isStarPlayer()` function
   - Update `determineOptimalSide()` to accept `playerName` parameter
   - Force `'over'` return for star players

---

## How It Works

```text
Pre-Game Flow:
┌─────────────────────────────────────────────────────────┐
│ Luka Doncic - Points Prop 28.5                         │
├─────────────────────────────────────────────────────────┤
│ ⭐ STAR PLAYER DETECTED                                │
│ → Category Analyzer: BLOCKED from all UNDER categories │
│ → Sweet Spots: Only shows OVER 28.5 recommendation     │
└─────────────────────────────────────────────────────────┘

Live Game Flow (Q3, 14 pts):
┌─────────────────────────────────────────────────────────┐
│ Luka Doncic - PTS OVER 28.5 (Current: 14)              │
├─────────────────────────────────────────────────────────┤
│ 🐢 SLOW PACE ALERT                                     │
│ Producing 0.51/min, need 0.72/min                      │
│ Projected: 23.4 pts (−5.1 gap)                         │
│                                                         │
│ ⚠️ Consider UNDER 28.5 hedge                           │
│ Current odds: -115 | Suggested: $25-50                 │
└─────────────────────────────────────────────────────────┘
```

---

## Star Players List (30 names)

| Tier | Players |
|------|---------|
| **MVP Caliber** | Luka Doncic, Anthony Edwards, Shai Gilgeous-Alexander, Giannis, Jokic, Jayson Tatum |
| **All-NBA** | Stephen Curry, Kevin Durant, LeBron James, Joel Embiid, Devin Booker, Ja Morant |
| **All-Star** | Donovan Mitchell, Trae Young, Damian Lillard, Kyrie Irving, Jaylen Brown, Tyrese Maxey |
| **Rising Stars** | Tyrese Haliburton, LaMelo Ball, Paolo Banchero, Victor Wembanyama, Jalen Brunson |
| **Elite Bigs** | Anthony Davis, Karl-Anthony Towns, Jimmy Butler, Zion Williamson |

---

## Expected Outcome

- ❌ No star player UNDER recommendations in Sweet Spots
- ✅ Star players only show OVER picks pre-game
- ⚡ Hedge system provides live UNDER alerts when stars underperform
- 📈 Eliminates high-risk UNDER picks on explosive scorers
