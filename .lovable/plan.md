
# Test Plan: All New Implementations

## Summary

I've explored the codebase and verified the implementations. Here's the testing status and what I'll create:

## Current Status

### 1. Edge Function: `calculate-quarter-baselines`
**Status: PASSED**
- Deployed successfully
- Executed and generated **263 baseline records** for **75 players**
- Database verified with player tiers (star, starter, role_player)
- Quarter distributions correctly calculated (Q1-Q4, H1-H2)

### 2. Database: `player_quarter_baselines` Table
**Status: VERIFIED**
- Table populated with correct schema
- Sample data verified:
  - Anthony Edwards: 29.20 pts avg, starter tier
  - Chet Holmgren: 17.20 pts avg, starter tier
  - Role players have different distributions (52% H1, 48% H2 vs 50/50 for starters)

### 3. Frontend Components Integration
**Status: INTEGRATED**
- `HedgeRecommendation.tsx` correctly imports and renders all new components
- Components render conditionally based on game state

---

## Test Files to Create

### 1. `src/hooks/useQuarterTransition.test.ts`
Tests for quarter transition detection:
- Detects Q1→Q2 transition
- Generates correct status (ahead/on_track/behind/critical)
- Calculates velocity and pace gap correctly
- Persists alerts for 3 minutes
- Handles halftime transitions

### 2. `src/hooks/useHalftimeRecalibration.test.ts`
Tests for halftime recalibration:
- Uses database baselines when available
- Falls back to tier-based defaults
- Calculates variance correctly
- Applies regression factors by tier
- Adjusts confidence based on 1H performance

### 3. `src/components/sweetspots/QuarterProgressSparkline.test.tsx`
Tests for sparkline visualization:
- Renders for live games only
- Calculates pace percentage correctly
- Colors bars based on performance vs expectation
- Shows mini version correctly

### 4. `src/components/sweetspots/PaceMomentumTracker.test.tsx`
Tests for pace tracker:
- Estimates quarter pace with multipliers
- Predicts 2H pace with regression
- Provides correct insights based on pace
- Shows impact on OVER/UNDER bets

### 5. `src/components/sweetspots/QuarterTransitionCard.test.tsx`
Tests for transition card UI:
- Renders headline correctly
- Shows velocity comparison
- Displays action recommendations
- Color-codes by status

### 6. `src/components/sweetspots/HalftimeRecalibrationCard.test.tsx`
Tests for halftime card UI:
- Shows 1H analysis section
- Compares linear vs recalibrated projections
- Displays recalibration factors
- Shows pace adjustment

---

## Test Implementation

I'll create comprehensive unit tests covering:

1. **Logic Tests**: Verify calculations in hooks
2. **Component Tests**: Verify UI rendering and conditional display
3. **Integration Tests**: Verify data flows correctly between components

### Mock Data Structure

```typescript
const mockSpot: DeepSweetSpot = {
  id: 'test-1',
  playerName: 'Test Player',
  teamName: 'Test Team',
  opponentName: 'Opponent Team',
  propType: 'points',
  side: 'over',
  line: 24.5,
  // ... full mock object
  liveData: {
    isLive: true,
    gameStatus: 'in_progress',
    currentValue: 8,
    projectedFinal: 26,
    gameProgress: 25,
    period: '2',
    clock: '6:30',
    confidence: 65,
    riskFlags: [],
    trend: 'up',
    minutesPlayed: 12,
    ratePerMinute: 0.67,
    paceRating: 102,
    currentQuarter: 2,
    quarterHistory: [],
  },
};
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/hooks/useQuarterTransition.test.ts` | Test quarter transition detection logic |
| `src/hooks/useHalftimeRecalibration.test.ts` | Test halftime recalibration calculations |
| `src/components/sweetspots/__tests__/QuarterProgressSparkline.test.tsx` | Test sparkline component |
| `src/components/sweetspots/__tests__/PaceMomentumTracker.test.tsx` | Test pace tracker component |
| `src/components/sweetspots/__tests__/QuarterTransitionCard.test.tsx` | Test transition card |
| `src/components/sweetspots/__tests__/HalftimeRecalibrationCard.test.tsx` | Test halftime card |

---

## Edge Function Test

I'll also create a Deno test for the edge function:

| File | Purpose |
|------|---------|
| `supabase/functions/calculate-quarter-baselines/index.test.ts` | Test edge function baseline calculation |
