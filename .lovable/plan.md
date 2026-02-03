

# Add Debug Logging for Shot Chart Matchup Attachment

## Overview

Add console logging to `useSweetSpotLiveData` to verify that `shotChartMatchup` data is being correctly attached to sweet spot entries.

## Implementation

**File: `src/hooks/useSweetSpotLiveData.ts`**

Add debug logging inside the `useMemo` that processes spots, after the matchup lookup:

```typescript
// Around line 32-35, after getting shotChartMatchup
let shotChartMatchup: ShotChartAnalysis | undefined = undefined;
if ((spot.propType === 'points' || spot.propType === 'threes') && spot.opponentName) {
  shotChartMatchup = getMatchup(spot.playerName, spot.opponentName, spot.propType) ?? undefined;
  
  // DEBUG: Log matchup attachment
  console.log('[SweetSpotLiveData] Matchup lookup:', {
    player: spot.playerName,
    opponent: spot.opponentName,
    propType: spot.propType,
    hasMatchup: !!shotChartMatchup,
    matchupScore: shotChartMatchup?.overallMatchupScore ?? null,
    zoneCount: shotChartMatchup?.zones?.length ?? 0,
  });
}
```

Also add a summary log at the end of the memo:

```typescript
// Before returning enrichedSpots, add summary
const spotsWithMatchups = enrichedSpots.filter(s => s.liveData?.shotChartMatchup);
console.log('[SweetSpotLiveData] Summary:', {
  totalSpots: spots.length,
  enrichedCount: enrichedSpots.length,
  spotsWithMatchups: spotsWithMatchups.length,
  pointsSpots: spots.filter(s => s.propType === 'points').length,
  threesSpots: spots.filter(s => s.propType === 'threes').length,
});
```

## Expected Console Output

When working correctly, you should see:
```
[SweetSpotLiveData] Matchup lookup: {player: "LeBron James", opponent: "BOS", propType: "points", hasMatchup: true, matchupScore: 58, zoneCount: 5}
[SweetSpotLiveData] Matchup lookup: {player: "Stephen Curry", opponent: "LAL", propType: "threes", hasMatchup: true, matchupScore: 72, zoneCount: 5}
...
[SweetSpotLiveData] Summary: {totalSpots: 24, enrichedCount: 24, spotsWithMatchups: 16, pointsSpots: 8, threesSpots: 8}
```

If matchups are NOT attaching, you'll see:
```
[SweetSpotLiveData] Matchup lookup: {player: "LeBron James", opponent: "BOS", propType: "points", hasMatchup: false, matchupScore: null, zoneCount: 0}
```

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useSweetSpotLiveData.ts` | Add console.log for individual matchup lookups and summary stats |

