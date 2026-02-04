
# Pre-Game Matchup Scanner Implementation Plan

## Overview
Build a comprehensive Pre-Game Matchup Scanner that analyzes player production zones against opponent defensive rankings to generate matchup grades before tip-off. This scanner will serve as a "stock market analyst" view, providing structured intelligence on which players have favorable/unfavorable matchups based on their shooting tendencies vs. opponent defensive weaknesses.

## Architecture

### Data Flow
```text
+-------------------------+     +------------------------+     +---------------------+
| player_zone_stats       | --> |                        | --> | Matchup Grade       |
| (468 players × 5 zones) |     | Pre-Game Scanner Hook  |     | A+, A, B+, B, C, D  |
+-------------------------+     |                        |     +---------------------+
                                |                        |
+-------------------------+     |  Calculates:           |     +---------------------+
| team_zone_defense       | --> |  - Zone advantage %    | --> | Zone Breakdown      |
| (30 teams × 5 zones)    |     |  - Weighted matchup    |     | (RA, Paint, Mid, 3) |
+-------------------------+     |  - Defense exploits    |     +---------------------+
                                |                        |
+-------------------------+     |                        |     +---------------------+
| unified_props           | --> |                        | --> | Recommendation      |
| (today's lines)         |     +------------------------+     | (OVER/UNDER boost)  |
+-------------------------+                                    +---------------------+
```

### Key Components

1. **usePreGameMatchupScanner Hook** - Core logic for batch analyzing all players in today's games
2. **MatchupScannerPage** - Dedicated page for pre-game analysis
3. **MatchupGradeCard** - Individual player matchup visualization
4. **ZoneBreakdownChart** - Visual breakdown of zone advantages
5. **DefenseExploitIndicator** - Shows which zones to attack

## Technical Implementation

### 1. New Hook: `src/hooks/usePreGameMatchupScanner.ts`

This hook will:
- Fetch all today's games from `unified_props` (pre-game only)
- Load zone stats for all players in today's games
- Load opponent zone defense data
- Calculate composite matchup grades

**Matchup Scoring Algorithm:**
```text
For each zone (RA, Paint, Mid, Corner3, Above3):
  playerFgPct = player's FG% in zone
  defenseOppFgPct = what defense allows in zone
  leagueAvgPct = league average for zone
  
  zoneAdvantage = playerFgPct - defenseOppFgPct
  volumeWeight = player's frequency in zone (0-1)
  
  zoneScore = zoneAdvantage × volumeWeight × 100
  
weightedTotal = Σ(zoneScore)
letterGrade = mapToGrade(weightedTotal)
  // A+ (>8), A (5-8), B+ (2-5), B (0-2), C (-3-0), D (<-3)
```

**Data Structure:**
```typescript
interface PlayerMatchupAnalysis {
  playerName: string;
  teamAbbrev: string;
  opponentAbbrev: string;
  gameTime: string;
  gameDescription: string;
  
  // Matchup metrics
  overallGrade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'D';
  overallScore: number; // -15 to +15
  
  // Zone breakdown
  zones: ZoneAnalysis[];
  
  // Key insights
  primaryZone: ZoneType;
  primaryZoneAdvantage: number;
  exploitableZones: ZoneType[]; // Zones with advantage > 5%
  avoidZones: ZoneType[]; // Zones with disadvantage < -5%
  
  // Prop recommendation
  scoringBoost: 'strong' | 'moderate' | 'neutral' | 'negative';
  threesBoost: 'strong' | 'moderate' | 'neutral' | 'negative';
  recommendation: string;
}

interface ZoneAnalysis {
  zone: ZoneType;
  playerFrequency: number; // % of shots
  playerFgPct: number;
  defenseAllowedPct: number;
  leagueAvgPct: number;
  advantage: number; // player - defense
  defenseRank: number; // 1-30
  defenseRating: DefenseRating;
  grade: 'advantage' | 'neutral' | 'disadvantage';
}
```

### 2. New Component: `src/components/matchup-scanner/MatchupScannerDashboard.tsx`

**Features:**
- Game-by-game grouping with tip-off countdown
- Filter by matchup grade (A+ only, A and above, etc.)
- Sort by: Grade, Game Time, Player Name
- Prop type filter (Points favored, 3PT favored)

**Layout:**
```text
┌─────────────────────────────────────────────────────────────┐
│ Pre-Game Matchup Scanner                      [Refresh] 🔄  │
│ Today's Tip-Off Analysis • 7 Games • 42 Players            │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│ │ A+ (3)  │ │ A  (8)  │ │ B+ (12) │ │ B  (10) │ [All] [⚡] │
│ └─────────┘ └─────────┘ └─────────┘ └─────────┘            │
├─────────────────────────────────────────────────────────────┤
│ DEN @ NYK • 7:10 PM ET                                      │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🏀 Nikola Jokic        A+   Paint Dominance             │ │
│ │ DEN vs NYK (Rank 18 Paint D)                            │ │
│ │ [RA: +8%] [Paint: +6%] [Mid: +3%] [3PT: -2%]           │ │
│ │ ✅ OVER PTS Boost • Primary: Restricted Area (42%)      │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🏀 Jalen Brunson       A    Mid-Range Master            │ │
│ │ NYK vs DEN (Rank 22 Mid-Range D)                        │ │
│ │ [RA: +2%] [Paint: +1%] [Mid: +9%] [3PT: 0%]            │ │
│ │ ✅ OVER PTS Boost • Primary: Mid-Range (38%)            │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### 3. New Component: `src/components/matchup-scanner/MatchupGradeCard.tsx`

**Features:**
- Color-coded grade badge (A+ = Gold, A = Green, B+ = Teal, B = Yellow, C = Gray, D = Red)
- Zone advantage chips with +/- indicators
- Visual half-court mini-chart (compact version of existing ShotChartMatchup)
- Expand to see full zone breakdown
- Quick-add to parlay builder

### 4. New Component: `src/components/matchup-scanner/ZoneAdvantageBar.tsx`

Horizontal bar visualization showing:
- Player's zone frequency (width of bar)
- Advantage vs. defense (color: green = advantage, red = disadvantage)
- Defense rank indicator (1-30 with elite/poor labels)

### 5. Integration Points

**SweetSpots Page Integration:**
- Add "Pre-Game Scanner" tab or section above the existing cards
- Link scanner grades to existing SweetSpotCard components

**Navigation:**
- Add to main navigation as "Matchup Scanner" or accessible from Sweet Spots page

## Files to Create

| File | Purpose |
|------|---------|
| `src/hooks/usePreGameMatchupScanner.ts` | Core hook for batch matchup analysis |
| `src/components/matchup-scanner/MatchupScannerDashboard.tsx` | Main dashboard component |
| `src/components/matchup-scanner/MatchupGradeCard.tsx` | Individual player matchup card |
| `src/components/matchup-scanner/ZoneAdvantageBar.tsx` | Zone advantage visualization |
| `src/components/matchup-scanner/GameGroupHeader.tsx` | Game section header with countdown |
| `src/components/matchup-scanner/GradeFilterBar.tsx` | Filter by grade/prop type |

## Files to Modify

| File | Change |
|------|--------|
| `src/pages/SweetSpots.tsx` | Add scanner section or tab |
| `src/types/sweetSpot.ts` | Add new types for matchup analysis |

## Matchup Grade Thresholds

| Grade | Score Range | Label | Color |
|-------|-------------|-------|-------|
| A+ | > +8.0 | Elite Matchup | Gold/Amber |
| A | +5.0 to +8.0 | Strong Advantage | Green |
| B+ | +2.0 to +5.0 | Moderate Advantage | Teal |
| B | 0 to +2.0 | Slight Edge | Yellow |
| C | -3.0 to 0 | Neutral/Slight Disadvantage | Gray |
| D | < -3.0 | Disadvantage | Red |

## Recommendation Logic

**For Points OVER:**
- A+ or A grade with RA/Paint primary zone → "Strong OVER boost"
- B+ grade or Mid-Range primary → "Moderate OVER boost"
- C or D grade → "Caution on OVER"

**For 3PT OVER:**
- A+ or A grade with Corner3/Above3 primary zone → "Strong 3PT OVER boost"
- Defense rank > 20 on 3PT zones → "3PT advantage"
- Defense rank < 10 → "Avoid 3PT OVER"

## Test Coverage

| Test File | Coverage |
|-----------|----------|
| `src/hooks/usePreGameMatchupScanner.test.ts` | Grade calculation, zone scoring, filtering |
| `src/components/matchup-scanner/__tests__/MatchupGradeCard.test.tsx` | UI rendering, grade colors |
| `src/components/matchup-scanner/__tests__/ZoneAdvantageBar.test.tsx` | Bar sizing, color logic |

## Implementation Order

1. Add new types to `sweetSpot.ts`
2. Create `usePreGameMatchupScanner.ts` hook
3. Create `ZoneAdvantageBar.tsx` (reusable visualization)
4. Create `MatchupGradeCard.tsx` (individual player card)
5. Create `GradeFilterBar.tsx` and `GameGroupHeader.tsx`
6. Create `MatchupScannerDashboard.tsx` (main dashboard)
7. Integrate into `SweetSpots.tsx` page
8. Add unit tests for hook and components
