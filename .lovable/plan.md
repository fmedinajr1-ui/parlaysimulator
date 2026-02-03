
# Add Shot Chart Preview Section to SweetSpotCard

## Overview

Create a standalone `ShotChartPreview` component that displays shot chart matchup analysis for Points and 3PM props before games start. This allows users to see pre-game insights about how a player's shooting zones match up against the opponent's defensive strengths.

---

## Problem

Currently, the shot chart visualization is only visible inside `HedgeRecommendation`, which only renders when `spot.liveData?.isLive === true`. This means users cannot see the valuable zone matchup analysis until a game is in progress.

The data is already being populated correctly by `useBatchShotChartAnalysis` and attached to spots via `useSweetSpotLiveData` (even for non-live games with `isLive: false`), but there's no UI component to display it outside of live games.

---

## Solution

Create a new `ShotChartPreview` component that:
1. Shows for Points and 3PM props only
2. Displays when game is NOT live (or as a pregame insight)
3. Uses the existing `ShotChartMatchup` visualization component
4. Includes the matchup recommendation and primary zone info
5. Uses a collapsible/expandable design to save space

---

## Phase 1: Create ShotChartPreview Component

**New File: `src/components/sweetspots/ShotChartPreview.tsx`**

```text
Structure:
- Accepts: spot (DeepSweetSpot)
- Guards: Only render for points/threes props with shotChartMatchup data
- Guards: Don't render if game is already live (HedgeRecommendation handles that)
- Layout:
  - Collapsible header with "Shot Chart Matchup" label
  - Matchup score badge (colored by advantage/disadvantage)
  - When expanded: ShotChartMatchup visualization + recommendation text
```

Key features:
- Collapsed by default to save vertical space
- Shows overall matchup score in the header even when collapsed
- Click to expand reveals the half-court visualization
- Color-coded border based on matchup advantage

---

## Phase 2: Integrate into SweetSpotCard

**Modify: `src/components/sweetspots/SweetSpotCard.tsx`**

Add the ShotChartPreview component after the Prop Type Badge section, showing for non-live games:

```text
{/* Shot Chart Preview (for non-live points/threes props) */}
{(spot.propType === 'points' || spot.propType === 'threes') && 
 !spot.liveData?.isLive && 
 spot.liveData?.shotChartMatchup && (
  <ShotChartPreview spot={spot} />
)}
```

---

## Component Design

```text
┌─────────────────────────────────────────────────┐
│ 🎯 Shot Chart Matchup               [+3.2] ▼    │  <- Collapsed (default)
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ 🎯 Shot Chart Matchup               [+3.2] ▲    │  <- Expanded
├─────────────────────────────────────────────────┤
│  ┌────────────┐  Primary Zone: Paint (42%)      │
│  │            │  vs BOS Defense                 │
│  │  Half-     │                                 │
│  │  Court     │  "Favorable PTS matchup in      │
│  │  SVG       │   Paint"                        │
│  │            │                                 │
│  └────────────┘  [Adv] [Neu] [Dis] Legend       │
└─────────────────────────────────────────────────┘
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/sweetspots/ShotChartPreview.tsx` | Collapsible pregame shot chart visualization |

## Files to Modify

| File | Change |
|------|--------|
| `src/components/sweetspots/SweetSpotCard.tsx` | Import and render ShotChartPreview for non-live points/threes props |

---

## Implementation Details

### ShotChartPreview Component

```typescript
// Key props and structure
interface ShotChartPreviewProps {
  spot: DeepSweetSpot;
}

export function ShotChartPreview({ spot }: ShotChartPreviewProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const matchup = spot.liveData?.shotChartMatchup;
  
  // Guard: Only for points/threes with matchup data, non-live games
  if (!matchup) return null;
  if (spot.propType !== 'points' && spot.propType !== 'threes') return null;
  if (spot.liveData?.isLive) return null; // HedgeRecommendation handles live
  
  const score = matchup.overallMatchupScore;
  const isPositive = score > 0;
  const isStrong = Math.abs(score) > 3;
  
  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <CollapsibleTrigger className="...">
        {/* Header with icon, label, score badge, chevron */}
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* ShotChartMatchup visualization + info */}
      </CollapsibleContent>
    </Collapsible>
  );
}
```

### Color Coding

| Score Range | Color | Label |
|-------------|-------|-------|
| > +3 | Green | Strong Advantage |
| 0 to +3 | Teal | Slight Advantage |
| -3 to 0 | Yellow | Neutral |
| < -3 | Red | Disadvantage |

---

## Expected Result

After implementation:
- All Points and 3PM sweet spots will show a "Shot Chart Matchup" section
- Collapsed by default with matchup score visible
- Users can expand to see the full half-court visualization
- Works as a pregame insight tool (no live data required)
- During live games, this section hides and `HedgeRecommendation` takes over with actionable hedge alerts
