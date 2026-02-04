
# Enhance Matchup Scanner: Clear Prop Type Labels

## Current State

The scanner already calculates `propEdgeType` correctly:
- **Points edge**: When advantage is in scoring zones (restricted area, paint, mid-range)
- **3PT edge**: When advantage is in perimeter zones (corner 3, above break 3)
- **Both**: When both have an edge
- **None**: When no clear prop advantage

The UI shows "POINTS OVER" or "3PT UNDER" but it's subtle and can be missed.

---

## Proposed Enhancements

### 1. Make Prop Type More Prominent in Card Header

**Current Display:**
```
#1  [+8.2]  Anthony Edwards      🟢 OVER
    POINTS OVER • Strong edge
```

**Enhanced Display:**
```
#1  [+8.2]  Anthony Edwards
    🏀 POINTS OVER                 [Strong Edge]
    "Defense allows 58% at the rim (5th worst)"
```

Move the prop type + side to its own prominent line with an icon.

---

### 2. Add Prop Type Icon

| Prop Type | Icon | Color |
|-----------|------|-------|
| POINTS | 🎯 Target | Amber/Gold |
| 3PT | 🏀 Basketball | Cyan |
| BOTH | 🔥 Fire | Purple |
| NONE | — | Gray (muted) |

---

### 3. Update Stats Cards to Show Prop Breakdown

Add prop-specific counts to the dashboard header:

```
[🟢 12 OVER]  [🔴 8 UNDER]  [⚪ 15 PASS]

Breakdown:
🎯 Points: 14 plays  |  🏀 3PT: 6 plays
```

---

### 4. Add Prop Type Filter

Let users filter by prop type:
- All Props
- Points Only
- 3PT Only

---

## Technical Changes

### File: `src/components/matchup-scanner/MatchupGradeCard.tsx`

1. **Redesign prop type display** (lines 131-147):
   - Make prop type + side the main focus
   - Add visual icons for each prop type
   - Use larger, bolder styling

2. **Update prop labels** (lines 52-58):
   ```typescript
   const propTypeConfig = {
     points: { label: 'POINTS', icon: Target, color: 'text-amber-400' },
     threes: { label: '3PT', icon: Crosshair, color: 'text-cyan-400' },
     both: { label: 'PTS & 3PT', icon: Flame, color: 'text-purple-400' },
     none: { label: '', icon: null, color: 'text-muted-foreground' },
   };
   ```

### File: `src/components/matchup-scanner/MatchupScannerDashboard.tsx`

1. **Add prop type breakdown to stats** (after line 91):
   - Show counts for Points vs 3PT plays
   
### File: `src/components/matchup-scanner/SideFilterBar.tsx`

1. **Add prop type filter**:
   - New toggle: "All" | "Points" | "3PT"

### File: `src/hooks/usePreGameMatchupScanner.ts`

1. **Add prop type counts to stats**:
   ```typescript
   pointsEdgeCount: number;
   threesEdgeCount: number;
   ```

### File: `src/types/matchupScanner.ts`

1. **Add new stat fields**:
   ```typescript
   interface MatchupScannerStats {
     // existing...
     pointsEdgeCount: number;
     threesEdgeCount: number;
   }
   ```

2. **Add filter field**:
   ```typescript
   interface MatchupScannerFilters {
     // existing...
     propTypeFilter?: PropEdgeType | 'all';
   }
   ```

---

## Visual Mockup

### Card After Changes

```
┌──────────────────────────────────────────┐
│ #1  +8.2  Anthony Edwards                │
│                                          │
│ 🎯 POINTS OVER          [Strong Edge] 🟢│
│                                          │
│ "Defense allows 58% at the rim           │
│  (5th worst in NBA)"                     │
│                                          │
│ MIN vs NYK • 7:30 PM ET           [▼]   │
└──────────────────────────────────────────┘
```

### Stats Summary

```
┌──────────────────────────────────────────┐
│ 🟢 OVER: 12 │ 🔴 UNDER: 8 │ ⚪ PASS: 15 │
├──────────────────────────────────────────┤
│ 🎯 Points: 14     │     🏀 3PT: 6       │
└──────────────────────────────────────────┘

[All] [🟢 Over] [🔴 Under] [🎯 Points] [🏀 3PT]
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/types/matchupScanner.ts` | Add `pointsEdgeCount`, `threesEdgeCount`, `propTypeFilter` |
| `src/hooks/usePreGameMatchupScanner.ts` | Calculate prop counts, add filter logic |
| `src/components/matchup-scanner/MatchupGradeCard.tsx` | Redesign with prominent prop type icons |
| `src/components/matchup-scanner/MatchupScannerDashboard.tsx` | Add prop breakdown to stats |
| `src/components/matchup-scanner/SideFilterBar.tsx` | Add prop type filter buttons |
