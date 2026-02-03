
# Batch Shot Chart Analysis Implementation

## Problem
The current `useShotChartAnalysis` hook fetches data for a single player, but React's rules of hooks prevent calling it in a loop inside `useSweetSpotLiveData`. This means the `shotChartMatchup` field in `LivePropData` is never populated, and the HedgeRecommendation component never shows the shot chart visualization.

## Solution
Create a batch-loading hook that fetches ALL player zone stats and ALL team zone defense data in just 2 queries, then provides a memoized lookup function to generate matchup analysis for any player-opponent pair.

---

## Phase 1: Create Batch Shot Chart Hook

**New File: `src/hooks/useBatchShotChartAnalysis.ts`**

This hook will:
1. Fetch all `player_zone_stats` records in a single query (cached for 1 hour)
2. Fetch all `team_zone_defense` records in a single query (cached for 1 hour)
3. Expose a `getMatchup(playerName, opponentAbbrev, propType)` function that:
   - Filters the cached data for the specific player/opponent
   - Calculates matchup grades per zone
   - Returns a complete `ShotChartAnalysis` object or `null`

```typescript
// Structure
export function useBatchShotChartAnalysis(enabled: boolean = true) {
  // Query 1: All player zone stats
  const { data: allPlayerZones } = useQuery({
    queryKey: ['all-player-zone-stats'],
    queryFn: async () => {
      const { data } = await supabase
        .from('player_zone_stats')
        .select('*')
        .eq('season', '2024-25');
      return data;
    },
    staleTime: 1000 * 60 * 60, // 1 hour cache
    enabled,
  });

  // Query 2: All team zone defense
  const { data: allDefenseZones } = useQuery({
    queryKey: ['all-team-zone-defense'],
    queryFn: async () => {
      const { data } = await supabase
        .from('team_zone_defense')
        .select('*')
        .eq('season', '2024-25');
      return data;
    },
    staleTime: 1000 * 60 * 60,
    enabled,
  });

  // Memoized lookup function
  const getMatchup = useCallback((
    playerName: string,
    opponentAbbrev: string,
    propType: PropType
  ): ShotChartAnalysis | null => {
    // Only for scoring props
    if (!['points', 'threes'].includes(propType)) return null;
    
    // Filter player zones
    const playerZones = allPlayerZones?.filter(
      z => z.player_name === playerName
    );
    
    // Filter defense zones
    const defenseZones = allDefenseZones?.filter(
      z => z.team_abbrev === opponentAbbrev
    );
    
    if (!playerZones?.length || !defenseZones?.length) return null;
    
    // Calculate matchup (reuse existing logic)
    return calculateAnalysis(playerZones, defenseZones, playerName, opponentAbbrev, propType);
  }, [allPlayerZones, allDefenseZones]);

  return {
    getMatchup,
    isLoading: !allPlayerZones || !allDefenseZones,
  };
}
```

---

## Phase 2: Integrate into Sweet Spot Live Data Hook

**Modify: `src/hooks/useSweetSpotLiveData.ts`**

Add the batch hook and enrich spots with shot chart matchup data:

```typescript
import { useBatchShotChartAnalysis } from './useBatchShotChartAnalysis';

export function useSweetSpotLiveData(spots: DeepSweetSpot[]) {
  const { games, findPlayer, getPlayerProjection, isLoading, error } = useUnifiedLiveFeed({...});
  
  // NEW: Batch shot chart data
  const { getMatchup, isLoading: shotChartLoading } = useBatchShotChartAnalysis(spots.length > 0);
  
  const enrichedSpots = useMemo(() => {
    if (!games.length) return spots;
    
    return spots.map(spot => {
      const result = findPlayer(spot.playerName);
      if (!result) {
        // NEW: Still add shot chart even if game not live
        if ((spot.propType === 'points' || spot.propType === 'threes') && spot.opponentName) {
          const shotChartMatchup = getMatchup(spot.playerName, spot.opponentName, spot.propType);
          if (shotChartMatchup) {
            return { ...spot, liveData: { ...createDefaultLiveData(), shotChartMatchup } };
          }
        }
        return spot;
      }
      
      const { player, game } = result;
      const projection = getPlayerProjection(spot.playerName, spot.propType);
      
      if (game.status !== 'in_progress') return spot;
      
      // NEW: Get shot chart matchup for scoring props
      let shotChartMatchup: ShotChartAnalysis | undefined = undefined;
      if ((spot.propType === 'points' || spot.propType === 'threes') && spot.opponentName) {
        shotChartMatchup = getMatchup(spot.playerName, spot.opponentName, spot.propType) ?? undefined;
      }
      
      const liveData: LivePropData = {
        // ... existing fields ...
        shotChartMatchup,  // NEW
      };
      
      return { ...spot, liveData };
    });
  }, [spots, games, findPlayer, getPlayerProjection, getMatchup]);
  
  // ... rest unchanged
}
```

---

## Phase 3: Handle Opponent Name Format

The `DeepSweetSpot.opponentName` field may contain full team names (e.g., "Boston Celtics") while `team_zone_defense` uses abbreviations (e.g., "BOS").

**Solution**: Create a mapping utility or use the existing `team_aliases` table to resolve names:

```typescript
// In the batch hook or as a separate utility
const TEAM_ABBREV_MAP: Record<string, string> = {
  'Boston Celtics': 'BOS',
  'Los Angeles Lakers': 'LAL',
  'Golden State Warriors': 'GSW',
  // ... all 30 teams
};

function normalizeOpponent(opponentName: string): string {
  // Try direct match
  if (TEAM_ABBREV_MAP[opponentName]) return TEAM_ABBREV_MAP[opponentName];
  
  // Try abbreviation (already correct)
  if (opponentName.length <= 4) return opponentName.toUpperCase();
  
  // Fallback: extract from partial match
  const lower = opponentName.toLowerCase();
  for (const [name, abbrev] of Object.entries(TEAM_ABBREV_MAP)) {
    if (lower.includes(name.toLowerCase().split(' ').pop() || '')) {
      return abbrev;
    }
  }
  return opponentName;
}
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/hooks/useBatchShotChartAnalysis.ts` | Batch load all shot chart data + lookup function |

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/useSweetSpotLiveData.ts` | Import batch hook, add `shotChartMatchup` to `LivePropData` |

---

## Data Flow After Implementation

```text
Page Load (/sweet-spots)
    │
    ├──→ useBatchShotChartAnalysis
    │         │
    │         ├──→ Query: player_zone_stats (all ~750 rows)
    │         ├──→ Query: team_zone_defense (all ~150 rows)
    │         └──→ Returns getMatchup() function
    │
    └──→ useSweetSpotLiveData
              │
              ├──→ For each spot:
              │         ├──→ Existing: Live stats from unified feed
              │         └──→ NEW: getMatchup(player, opponent, propType)
              │                     └──→ Returns ShotChartAnalysis
              │
              └──→ HedgeRecommendation
                        │
                        └──→ Displays shot chart visualization
                             Adjusts hedge urgency based on zones
```

---

## Expected Result

After this change:
- Points and 3PM props will show the half-court shot chart visualization
- Shot chart appears even before game starts (pregame matchup data)
- Hedge urgency adjusts based on zone advantages/disadvantages
- Only 2 additional queries total (cached for 1 hour)
