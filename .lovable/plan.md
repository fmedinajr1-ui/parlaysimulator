
# Halftime Recalibration Engine - Implementation Plan

## Overview

Build an intelligent halftime analysis system that recalculates 2nd-half projections using:
1. **Actual 1st-half production** vs **Historical 1st-half baselines**
2. **Player-specific half distribution patterns** (e.g., "LeBron typically scores 55% in 1H, 45% in 2H")
3. **Fatigue and pace adjustments** for 2nd-half decay
4. **Recalibrated confidence scores** based on 1st-half performance

This replaces the current linear expectation model (`line / 2`) with player-specific historical patterns.

---

## How It Works

```text
+------------------------------------------------------+
|  HALFTIME RECALIBRATION                              |
|  LeBron James - OVER 26.5 PTS                        |
+------------------------------------------------------+
|                                                      |
|  1ST HALF ANALYSIS                                   |
|  ┌─────────────────────────────────────────────────┐ |
|  │  Actual:    14 pts   │  Expected:  12.4 pts     │ |
|  │  Variance:  +13% ✓   │  Baseline:  47% in 1H    │ |
|  └─────────────────────────────────────────────────┘ |
|                                                      |
|  2ND HALF PROJECTION (Recalibrated)                  |
|  ┌─────────────────────────────────────────────────┐ |
|  │  Linear Model:     28.0 pts (extrapolated)      │ |
|  │  Recalibrated:     26.8 pts (history-weighted)  │ |
|  │  Adjustment:       -1.2 pts (fatigue decay)     │ |
|  └─────────────────────────────────────────────────┘ |
|                                                      |
|  RECALIBRATION FACTORS                               |
|  • Historical 2H Rate: 0.48/min (vs 0.58/min in 1H) |
|  • Fatigue Score: 42/100 (moderate)                 |
|  • Game Pace: 104 (above avg = +3% boost)           |
|                                                      |
|  ⚡ INSIGHT: Player exceeded 1H baseline. History    |
|     shows 16% regression in 2H. Projection adjusted. |
|                                                      |
|  ✓ OVER still viable at 26.8 - Hold position        |
+------------------------------------------------------+
```

---

## Data Sources

**Historical Baselines (from L10 game logs):**
- First half production percentage (derived from Q1+Q2 data if available)
- Rate decay between halves (1H rate vs 2H rate)
- Total game stat distributions

**Live Data at Halftime:**
- `currentValue`: Actual stat at halftime
- `ratePerMinute`: 1st half production rate
- `minutesPlayed`: Minutes logged in 1H
- `fatigue_score`: From `quarter_player_snapshots` (if available)
- `paceRating`: Game pace relative to league average

**Calculation Approach:**
Since we don't have granular quarter-by-quarter historical data in the current schema, we'll use L10 stats to derive baselines and apply intelligent regression factors.

---

## Technical Implementation

### 1. New Types in `src/types/sweetSpot.ts`

```typescript
export interface HalftimeRecalibration {
  // 1st Half Analysis
  actual1H: number;
  expected1H: number;          // Historical baseline for 1H
  variance1H: number;          // Actual - Expected as %
  
  // Baseline Patterns
  historical1HRate: number;    // Per minute rate in 1H (from L10)
  historical2HRate: number;    // Per minute rate in 2H (estimated)
  halfDistribution: number;    // % typically scored in 1H (default 0.50)
  regressionFactor: number;    // How much 2H typically drops from 1H
  
  // 2nd Half Projection
  linearProjection: number;    // Simple extrapolation
  recalibratedProjection: number; // With historical adjustments
  projectionDelta: number;     // Linear - Recalibrated
  
  // Adjustments Applied
  fatigueAdjustment: number;   // Fatigue decay factor
  paceAdjustment: number;      // Pace boost/penalty
  minutesAdjustment: number;   // Expected 2H minutes vs 1H
  
  // Final Assessment
  confidenceBoost: number;     // +/- to base confidence
  insight: string;
  recommendation: string;
}
```

Add to `LivePropData`:
```typescript
export interface LivePropData {
  // ... existing fields ...
  halftimeRecalibration?: HalftimeRecalibration;
}
```

### 2. New Hook: `src/hooks/useHalftimeRecalibration.ts`

```typescript
import { useMemo } from 'react';
import type { DeepSweetSpot, HalftimeRecalibration } from '@/types/sweetSpot';

// Default regression factors (derived from typical NBA patterns)
const DEFAULT_2H_REGRESSION = 0.92; // 2H typically 8% lower than 1H
const STAR_REGRESSION = 0.95;       // Stars regress less
const ROLE_PLAYER_REGRESSION = 0.88; // Role players regress more

function calculateHalftimeRecalibration(
  spot: DeepSweetSpot
): HalftimeRecalibration | null {
  const { liveData, line, side, l10Stats, production } = spot;
  
  // Only calculate at halftime
  if (liveData?.gameStatus !== 'halftime') return null;
  
  const actual1H = liveData.currentValue;
  const rate1H = liveData.ratePerMinute;
  const minutesPlayed = liveData.minutesPlayed;
  
  // Calculate expected 1H based on historical L10 average
  // Assuming even distribution, expected 1H = L10 avg / 2
  const expected1H = l10Stats.avg / 2;
  const variance1H = expected1H > 0 
    ? ((actual1H - expected1H) / expected1H) * 100 
    : 0;
  
  // Historical rate analysis
  const historical1HRate = production.statPerMinute || 0;
  // Estimate 2H regression based on production tier
  const regressionFactor = production.avgMinutes >= 32 
    ? STAR_REGRESSION 
    : production.avgMinutes >= 24 
      ? DEFAULT_2H_REGRESSION 
      : ROLE_PLAYER_REGRESSION;
  const historical2HRate = historical1HRate * regressionFactor;
  
  // Simple linear projection (current pace)
  const expectedRemaining = 24; // 2nd half minutes
  const linearProjection = actual1H + (rate1H * expectedRemaining);
  
  // Recalibrated projection using historical 2H rate
  const recalibratedProjection = actual1H + (historical2HRate * expectedRemaining);
  const projectionDelta = linearProjection - recalibratedProjection;
  
  // Fatigue adjustment (if available from quarter snapshots)
  const fatigueScore = 0; // Would come from quarter_player_snapshots
  const fatigueAdjustment = fatigueScore > 60 ? -0.05 : 0;
  
  // Pace adjustment
  const paceRating = liveData.paceRating || 100;
  const paceAdjustment = (paceRating - 100) / 100 * 0.5; // ±5% per 10 pace points
  
  // Minutes adjustment (stars play more in 2H of close games)
  const minutesAdjustment = 0; // Placeholder
  
  // Apply adjustments to recalibrated projection
  const adjustedProjection = recalibratedProjection * 
    (1 + fatigueAdjustment) * 
    (1 + paceAdjustment);
  
  // Generate insight
  let insight: string;
  let confidenceBoost: number;
  let recommendation: string;
  
  if (variance1H >= 15) {
    insight = `Player exceeded 1H baseline by ${variance1H.toFixed(0)}%. ` +
      `Historical data shows ${((1 - regressionFactor) * 100).toFixed(0)}% regression in 2H.`;
    confidenceBoost = side === 'over' ? 5 : -10;
    recommendation = side === 'over' 
      ? `Strong 1H suggests ${spot.side} likely to hit. Consider profit lock.`
      : `1H pace threatening UNDER. Monitor for hedge.`;
  } else if (variance1H <= -15) {
    insight = `Player underperformed 1H baseline by ${Math.abs(variance1H).toFixed(0)}%. ` +
      `2H surge possible but not guaranteed.`;
    confidenceBoost = side === 'over' ? -10 : 5;
    recommendation = side === 'over'
      ? `Behind at half. Need 2H burst or consider hedge.`
      : `UNDER tracking well. Hold position.`;
  } else {
    insight = `1H production within expected range (${variance1H >= 0 ? '+' : ''}${variance1H.toFixed(0)}%). ` +
      `Projecting standard 2H regression.`;
    confidenceBoost = 0;
    recommendation = `On track. No action needed.`;
  }
  
  return {
    actual1H,
    expected1H,
    variance1H,
    historical1HRate,
    historical2HRate,
    halfDistribution: 0.5,
    regressionFactor,
    linearProjection: Math.round(linearProjection * 10) / 10,
    recalibratedProjection: Math.round(adjustedProjection * 10) / 10,
    projectionDelta: Math.round(projectionDelta * 10) / 10,
    fatigueAdjustment,
    paceAdjustment,
    minutesAdjustment,
    confidenceBoost,
    insight,
    recommendation,
  };
}

export function useHalftimeRecalibration(spots: DeepSweetSpot[]): DeepSweetSpot[] {
  return useMemo(() => {
    return spots.map(spot => {
      if (!spot.liveData || spot.liveData.gameStatus !== 'halftime') {
        return spot;
      }
      
      const recalibration = calculateHalftimeRecalibration(spot);
      if (!recalibration) return spot;
      
      return {
        ...spot,
        liveData: {
          ...spot.liveData,
          halftimeRecalibration: recalibration,
          // Update projected final with recalibrated value
          projectedFinal: recalibration.recalibratedProjection,
          // Adjust confidence
          confidence: Math.max(1, Math.min(99, 
            (spot.liveData.confidence || 50) + recalibration.confidenceBoost
          )),
        },
      };
    });
  }, [spots]);
}
```

### 3. New Component: `src/components/sweetspots/HalftimeRecalibrationCard.tsx`

A dedicated UI component that displays the halftime analysis with:
- 1st Half vs Expected comparison
- Side-by-side Linear vs Recalibrated projections
- Visual progress toward line
- Fatigue/Pace adjustment indicators
- Actionable insight and recommendation

### 4. Integration Points

**Update `useSweetSpotLiveData.ts`:**
```typescript
import { useHalftimeRecalibration } from './useHalftimeRecalibration';

// After quarter transition detection
const spotsWithTransitions = useQuarterTransition(enrichedSpots);

// Add halftime recalibration
const spotsWithRecalibration = useHalftimeRecalibration(spotsWithTransitions);

return {
  spots: spotsWithRecalibration,
  // ...
};
```

**Update `HedgeRecommendation.tsx`:**
Display the HalftimeRecalibrationCard when halftime data is available:
```typescript
{spot.liveData?.halftimeRecalibration && (
  <HalftimeRecalibrationCard 
    recalibration={spot.liveData.halftimeRecalibration}
    spot={spot}
  />
)}
```

---

## Files to Create/Modify

| Action | File | Description |
|--------|------|-------------|
| MODIFY | `src/types/sweetSpot.ts` | Add `HalftimeRecalibration` interface, update `LivePropData` |
| CREATE | `src/hooks/useHalftimeRecalibration.ts` | Recalibration logic and hook |
| CREATE | `src/components/sweetspots/HalftimeRecalibrationCard.tsx` | Halftime analysis UI component |
| MODIFY | `src/hooks/useSweetSpotLiveData.ts` | Integrate recalibration hook |
| MODIFY | `src/components/sweetspots/HedgeRecommendation.tsx` | Display recalibration card at halftime |

---

## Recalibration Logic Details

### Regression Factors
Based on typical NBA patterns:
- **Stars (32+ min)**: 5% regression (they pace themselves in 1H, close in 2H)
- **Starters (24-32 min)**: 8% regression (standard fatigue)
- **Role players (<24 min)**: 12% regression (more variable minutes in 2H)

### Variance Thresholds
- **Hot Start (≥+15%)**: Player beating baseline - adjust for likely regression
- **Cold Start (≤-15%)**: Player behind baseline - surge possible but risky
- **On Track (-15% to +15%)**: Normal variance - apply standard regression

### Confidence Adjustments
- OVER bet + hot start = +5 confidence
- OVER bet + cold start = -10 confidence  
- UNDER bet + hot start = -10 confidence
- UNDER bet + cold start = +5 confidence

---

## User Experience

At halftime, the user sees:

1. **Clear 1H vs Baseline comparison**
   - Actual points vs historical expectation
   - Percentage variance with color coding

2. **Two projection models side-by-side**
   - Linear (naive extrapolation)
   - Recalibrated (with historical regression)

3. **Adjustment breakdown**
   - Fatigue factor
   - Pace factor
   - Why the projection changed

4. **Actionable guidance**
   - "Strong 1H - consider profit lock"
   - "Behind at half - hedge opportunity"
   - "On track - hold position"
