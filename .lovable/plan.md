

## Wire Halftime Recalibration Into Hedge Status

### Problem
On line 161, `calculateHedgeStatus` runs inside the enrichment memo using the raw linear `projectedFinal`. Then on line 171, `useHalftimeRecalibration` overwrites `projectedFinal` with the smarter 2H-adjusted value -- but the hedge status is already stale at that point.

```text
Current order:
  Line 161: calculateHedgeStatus() --> uses RAW linear projectedFinal
  Line 171: useHalftimeRecalibration() --> updates projectedFinal (too late!)
  Line 174: useHedgeStatusRecorder() --> records the stale hedge status
```

### Fix (1 file: `src/hooks/useSweetSpotLiveData.ts`)

**Step 1 -- Remove early hedge status calculation (line 159-161)**

Delete these lines from the enrichment memo:
```typescript
// REMOVE:
const enrichedSpot = { ...spot, liveData };
liveData.hedgeStatus = calculateHedgeStatus(enrichedSpot) ?? undefined;
return enrichedSpot;
```
Replace with just:
```typescript
return { ...spot, liveData };
```

**Step 2 -- Add post-recalibration hedge status calculation (after line 171)**

After `useHalftimeRecalibration` and before `useHedgeStatusRecorder`, add a new `useMemo` that recalculates hedge status on the recalibrated spots:

```typescript
const finalSpots = useMemo(() => {
  return spotsWithRecalibration.map(spot => {
    if (!spot.liveData) return spot;
    const hedgeStatus = calculateHedgeStatus(spot) ?? undefined;
    if (hedgeStatus === spot.liveData.hedgeStatus) return spot;
    return {
      ...spot,
      liveData: { ...spot.liveData, hedgeStatus },
    };
  });
}, [spotsWithRecalibration]);
```

**Step 3 -- Update all downstream references**

Replace `spotsWithRecalibration` with `finalSpots` in:
- `useHedgeStatusRecorder(finalSpots)` (line 174)
- `liveSpots` filter (line 183)
- `spotsWithLineMovement` filter (line 188)
- Return value `spots: finalSpots` (line 192)

### New execution order
```text
1. Enrich spots with live data (NO hedge status)
2. useQuarterTransition()
3. useHalftimeRecalibration() --> updates projectedFinal with regression/pace/fatigue
4. calculateHedgeStatus() --> NOW uses the recalibrated projection
5. useHedgeStatusRecorder() --> records the accurate status
```

### Impact
- At halftime, hedge alerts will use the 2H-adjusted projection (accounting for ~8% regression, pace shifts, fatigue) instead of raw linear pace
- During non-halftime periods, behavior is identical since recalibration only modifies halftime spots
- No database changes, no new files -- single file edit

