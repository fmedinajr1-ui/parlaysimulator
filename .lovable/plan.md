

# Fix War Room Not Showing Games

## Root Cause Analysis

The War Room game picker depends on `useDeepSweetSpots` → `useSweetSpotLiveData` → build game list. After investigating:

- **469 FanDuel props** exist across **5 games** for today
- All **63 players** have 5+ game logs in `nba_player_game_logs`
- RLS policies are all public-read
- Game descriptions use correct `"Team @ Team"` format

The component has **no loading state or error display** — if the `useDeepSweetSpots` query is loading or errored, it shows the exact same "No games with props available" message. This masks the real issue.

Two likely culprits:
1. **Silent react-query error**: One of the 4 sequential Supabase queries in `useDeepSweetSpots` may be timing out or failing. The component doesn't check `isLoading` or `error`.
2. **Missing `rebounds` prop type**: `mapPropType()` only supports `points`, `assists`, `threes`, `blocks` — it drops `rebounds` entirely, reducing prop coverage. While this alone shouldn't cause zero spots, combined with aggressive CV/edge filters, it shrinks the pool significantly.

## Changes

### 1. Add loading and error states to AdminWarRoomView
**File**: `src/components/admin/AdminWarRoomView.tsx`

Show a spinner while `useDeepSweetSpots` is loading, and display the error message if the query fails. Currently the component assumes data is available immediately.

```tsx
const { data: sweetSpotData, isLoading: spotsLoading, error: spotsError } = useDeepSweetSpots();

// In the no-game-selected view:
if (spotsLoading) return <Spinner />;
if (spotsError) return <ErrorMessage />;
```

### 2. Add `rebounds` and `steals` to mapPropType
**File**: `src/hooks/useDeepSweetSpots.ts`

Add `rebounds` and `steals` to the supported prop types. This requires also adding them to `PROP_TYPE_CONFIG` in `src/types/sweetSpot.ts` and adding the `gameLogField` mappings.

```typescript
// In mapPropType:
if (normalized.includes('rebound') || normalized === 'reb') return 'rebounds';
if (normalized.includes('steal') || normalized === 'stl') return 'steals';
```

### 3. Filter out combo prop types before mapping
**File**: `src/hooks/useDeepSweetSpots.ts`

Combo types like `points_assists` and `points_rebounds_assists` incorrectly map to `points` (because the string includes "point"). These have combined lines that don't match individual game log stats, producing garbage calculations. Filter them out before `mapPropType`:

```typescript
const COMBO_TYPES = ['points_assists', 'points_rebounds', 'points_rebounds_assists', 'rebounds_assists'];
const supportedProps = props
  .filter(p => !COMBO_TYPES.includes(p.prop_type))
  .map(p => ({ ...p, mappedType: mapPropType(p.prop_type) }))
  .filter(p => p.mappedType !== null);
```

### 4. Add `rebounds` and `steals` to PROP_TYPE_CONFIG and PropType
**File**: `src/types/sweetSpot.ts`

Extend the `PropType` union and `PROP_TYPE_CONFIG` record:

```typescript
export type PropType = 'points' | 'assists' | 'threes' | 'blocks' | 'rebounds' | 'steals';

// Add to PROP_TYPE_CONFIG:
rebounds: { gameLogField: 'rebounds', matchupKey: 'player_rebounds', label: 'Rebounds', shortLabel: 'REB' },
steals: { gameLogField: 'steals', matchupKey: 'player_steals', label: 'Steals', shortLabel: 'STL' },
```

### 5. Add `rebounds` and `steals` to game log query
**File**: `src/hooks/useDeepSweetSpots.ts`

Add `rebounds` and `steals` to the `nba_player_game_logs` select query (line 466) and update the `PROP_TO_STAT_KEY` map in `useSweetSpotLiveData.ts`.

## Files to Change
| File | Change |
|------|--------|
| `src/components/admin/AdminWarRoomView.tsx` | Add loading/error states |
| `src/hooks/useDeepSweetSpots.ts` | Filter combo types, add rebounds/steals to mapPropType, add to select query |
| `src/types/sweetSpot.ts` | Add `rebounds` and `steals` to PropType and PROP_TYPE_CONFIG |
| `src/hooks/useSweetSpotLiveData.ts` | Add rebounds/steals to PROP_TO_STAT_KEY |
| `src/components/scout/warroom/WarRoomLayout.tsx` | Add loading state awareness |

