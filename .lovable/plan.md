

# Matchup Scanner: Stock Market Style + OVER/UNDER Logic

## Current Issues

1. **OVER-only bias** - No UNDER recommendations even when defense is elite
2. **Technical jargon** - "Rim dominance", zone percentages confuse users
3. **Game-grouped sorting** - Not showing "best picks first" like a stock ticker

---

## New Approach: Stock Ticker Style

Display players ranked by **Edge Strength** (not grouped by game), with clear OVER/UNDER signals:

| Edge Score | Side | Display |
|------------|------|---------|
| +5 or more | 🟢 OVER | "Strong BUY on Points OVER" |
| +2 to +5 | 🟢 OVER | "Points OVER has edge" |
| -2 to +2 | ⚪ PASS | "No clear edge" |
| -2 to -5 | 🔴 UNDER | "Points UNDER has edge" |
| -5 or less | 🔴 UNDER | "Strong BUY on Points UNDER" |

---

## User-Facing Changes

### Before
```
[A+] Anthony Edwards - MIN vs NYK
     PTS 🔥 | 3PT 🔥
     Primary: Restricted Area (35%)
```

### After
```
#1  [+8.2] Anthony Edwards
    🟢 POINTS OVER • Strong edge
    "Defense allows 58% at the rim (5th worst in NBA)"
    MIN vs NYK • 7:30 PM

#2  [+6.1] Tyrese Maxey  
    🟢 3PT OVER • Good edge
    "Defense ranks 28th in corner 3 coverage"
    PHI @ BOS • 8:00 PM
    
#15 [-5.4] Scottie Barnes
    🔴 POINTS UNDER • Tough matchup
    "Defense ranks 2nd at the rim where he takes 40% of shots"
    TOR @ MIA • 7:30 PM
```

---

## Technical Changes

### 1. Type Updates (`src/types/matchupScanner.ts`)

Add new fields to `PlayerMatchupAnalysis`:

```typescript
// New fields
recommendedSide: 'over' | 'under' | 'pass';
sideStrength: 'strong' | 'moderate' | 'lean';
simpleReason: string;  // "Defense allows 58% at the rim (5th worst)"
edgeScore: number;     // Absolute value for sorting (higher = better opportunity)
rank: number;          // 1-based position in today's picks
propType: 'points' | 'threes' | 'both';
```

Update stats type:
```typescript
// Add to MatchupScannerStats
overCount: number;
underCount: number;
passCount: number;
```

---

### 2. Hook Logic Updates (`src/hooks/usePreGameMatchupScanner.ts`)

**A. Side Determination Function**
```typescript
function determineSide(score: number): { side, strength } {
  if (score >= 5) return { side: 'over', strength: 'strong' };
  if (score >= 2) return { side: 'over', strength: 'moderate' };
  if (score <= -5) return { side: 'under', strength: 'strong' };
  if (score <= -2) return { side: 'under', strength: 'moderate' };
  return { side: 'pass', strength: 'lean' };
}
```

**B. Simple Reason Generator**
```typescript
function generateSimpleReason(zones, side, primaryZone) {
  const pz = zones.find(z => z.zone === primaryZone);
  const rankLabel = getRankLabel(pz.defenseRank); // "5th worst", "3rd best"
  const zoneLabel = ZONE_DISPLAY_NAMES[primaryZone];
  
  if (side === 'over') {
    return `Defense allows ${pz.defenseAllowedPct}% ${zoneLabel.toLowerCase()} (${rankLabel})`;
  }
  if (side === 'under') {
    return `Defense ranks ${pz.defenseRank}th in ${zoneLabel.toLowerCase()} where player takes ${pz.frequency}% of shots`;
  }
  return "No clear matchup edge either way";
}
```

**C. Stock Ticker Sorting**
Replace game-grouped sorting with edge-based ranking:
```typescript
// Sort by absolute edge score (best opportunities first)
results.sort((a, b) => Math.abs(b.overallScore) - Math.abs(a.overallScore));

// Add rank
results.forEach((r, i) => r.rank = i + 1);
```

---

### 3. Dashboard Updates (`src/components/matchup-scanner/MatchupScannerDashboard.tsx`)

**A. Remove Game Grouping**
- Replace game-by-game layout with a single ranked list
- Add "View by Game" toggle for users who prefer that view

**B. Update Stats Cards**
Replace current cards with:
| Card | Value |
|------|-------|
| 🟢 OVER Plays | count with edge > +2 |
| 🔴 UNDER Plays | count with edge < -2 |
| ⚪ PASS | count with edge -2 to +2 |
| Total Analyzed | player count |

**C. Add Side Filter**
New filter options: "All" | "OVER Plays" | "UNDER Plays"

---

### 4. Card Redesign (`src/components/matchup-scanner/MatchupGradeCard.tsx`)

**A. New Layout**
```
┌─────────────────────────────────────────┐
│ #1  [+8.2]  Anthony Edwards            │
│     🟢 POINTS OVER • Strong edge       │
│     "Defense allows 58% at the rim"    │
│     MIN vs NYK • 7:30 PM ET            │
└─────────────────────────────────────────┘
```

**B. Color Coding**
- Green border/accent for OVER
- Red border/accent for UNDER  
- Gray border for PASS

**C. Keep Expanded View**
Zone breakdown stays in collapsible section for power users

---

### 5. Filter Bar Updates (`src/components/matchup-scanner/GradeFilterBar.tsx`)

Replace grade-based filters with side-based:

| Filter | Shows |
|--------|-------|
| All | All players |
| 🟢 OVER | Players with positive edge |
| 🔴 UNDER | Players with negative edge |
| 💪 Strong | Only "strong" confidence picks |
| Points | Players with points edge |
| 3PT | Players with 3-point edge |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/types/matchupScanner.ts` | Add `recommendedSide`, `simpleReason`, `edgeScore`, `rank`, remove old boost types |
| `src/hooks/usePreGameMatchupScanner.ts` | Add side logic, simple reason generator, stock ticker sorting |
| `src/components/matchup-scanner/MatchupGradeCard.tsx` | Redesign for OVER/UNDER display with rank |
| `src/components/matchup-scanner/MatchupScannerDashboard.tsx` | Switch to ranked list, update stats, add view toggle |
| `src/components/matchup-scanner/GradeFilterBar.tsx` | Replace grade filters with side filters |

---

## Example Output

After implementation, users see:

```
Pre-Game Matchup Scanner
Feb 4, 2026 • 7 Games • 43 Players

[🟢 12 OVER] [🔴 8 UNDER] [⚪ 23 PASS]

Filter: [All] [OVER ▼] [UNDER] [Strong Only]

──────────────────────────────────────

#1  +8.2  Anthony Edwards         🟢
    POINTS OVER • Strong edge
    "Defense allows 58% at the rim (5th worst)"
    MIN vs NYK • 7:30 PM

#2  +6.1  Tyrese Maxey            🟢  
    3PT OVER • Good edge
    "Defense ranks 28th in corner 3 coverage"
    PHI @ BOS • 8:00 PM

#3  -6.4  Scottie Barnes          🔴
    POINTS UNDER • Tough matchup
    "Defense ranks 2nd at rim (player's primary zone)"
    TOR @ MIA • 7:30 PM

...
```

This makes the scanner intuitive and actionable - users immediately see the best plays at the top, with clear OVER/UNDER guidance.

