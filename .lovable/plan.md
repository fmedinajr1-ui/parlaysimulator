
# Unified Props Hook with Proper UTC Timezone Handling

## Problem Summary

Both the 3PT and Assists hooks have identical bugs preventing accurate data display:

| Issue | Current (Wrong) | Correct |
|-------|-----------------|---------|
| Prop type (3PT) | `'player_threes'` | `'threes'` |
| Prop type (Assists) | `'player_assists'` | `'assists'` |
| Time boundary | `${analysisDate}T00:00:00` | `${nextDayUTC}T00:00:00` |

Games on Jan 29th Eastern Time are stored in the database as `2026-01-30 00:10:00+00` (UTC), so queries for "today's games" must use the next calendar day's UTC timestamps.

---

## Solution: Create Unified Hook

Create a single `useTodayProps` hook that:
1. Centralizes UTC timezone conversion logic
2. Supports both 3PT and Assists prop types
3. Properly fetches live lines with correct `prop_type` values
4. Calculates L5 averages from game logs

---

## Implementation Steps

### Step 1: Create `src/hooks/useTodayProps.ts`

A unified hook with these features:

**Configuration by Prop Type:**
```text
PROP_CONFIG = {
  threes: {
    propType: 'threes',              // For unified_props query
    sweetSpotCategory: 'THREE_POINT_SHOOTER',
    gameLogField: 'threes_made',
    reliabilityKey: 'player_threes'
  },
  assists: {
    propType: 'assists',             // For unified_props query  
    sweetSpotCategories: ['BIG_ASSIST_OVER', 'HIGH_ASSIST_UNDER', 'HIGH_ASSIST', 'ASSIST_ANCHOR'],
    gameLogField: 'assists',
    reliabilityKey: 'player_assists'
  }
}
```

**UTC Time Boundary Calculation:**
```typescript
function getUTCBoundariesForEasternDate(easternDate: string) {
  // Eastern games on Jan 29th start at 7pm ET = Jan 30th 00:00 UTC
  const nextDay = new Date(easternDate);
  nextDay.setDate(nextDay.getDate() + 1);
  const startUTC = `${nextDay.toISOString().split('T')[0]}T00:00:00`;
  const endUTC = `${nextDay.toISOString().split('T')[0]}T12:00:00`;
  return { startUTC, endUTC };
}
```

**Data Flow:**
```text
getEasternDate() ──► '2026-01-29' (analysis_date for sweet spots)
                          │
getUTCBoundaries() ──► startUTC: '2026-01-30T00:00:00'
                   ──► endUTC: '2026-01-30T12:00:00'
                          │
unified_props query ──► activePlayers Set + linesMap
                          │
category_sweet_spots ──► Filter by activePlayers ──► Raw Picks
                          │
nba_player_game_logs ──► l5Map (Last 5 game averages)
                          │
                          ▼
                    Final Picks with accurate data
```

### Step 2: Interface Definition

```typescript
export interface TodayPropPick {
  id: string;
  player_name: string;
  prop_type: string;
  category: string;
  recommended_line: number;
  actual_line: number | null;  // Live sportsbook line
  l10_hit_rate: number;
  l10_avg: number | null;
  l5_avg: number | null;       // Calculated from game logs
  confidence_score: number;
  projected_value: number | null;
  team: string;
  reliabilityTier: string | null;
  reliabilityHitRate: number | null;
  analysis_date: string;
  edge: number | null;         // projected_value - actual_line
  recommended_side: 'OVER' | 'UNDER';
}

interface UseTodayPropsOptions {
  propType: 'threes' | 'assists';
  targetDate?: Date;  // Defaults to today ET
  minHitRate?: number;
}
```

### Step 3: Update Existing Hooks

Keep the existing hooks for backward compatibility but have them use the unified hook internally:

**`useTomorrow3PTProps.ts`:**
```typescript
// Wrapper that uses the unified hook with threes config
export function useTomorrow3PTProps(options = {}) {
  return useTodayProps({ 
    propType: 'threes',
    ...options 
  });
}
```

**`useTomorrowAssistProps.ts`:**
```typescript
// Wrapper that uses the unified hook with assists config
export function useTomorrowAssistProps(options = {}) {
  const result = useTodayProps({ 
    propType: 'assists',
    ...options 
  });
  
  // Add category-specific grouping
  return {
    ...result,
    overPicks: result.picks.filter(p => !p.category.includes('UNDER')),
    underPicks: result.picks.filter(p => p.category.includes('UNDER')),
  };
}
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/useTodayProps.ts` | **Create** | Unified hook with proper UTC handling |
| `src/hooks/useTomorrow3PTProps.ts` | Modify | Use unified hook internally |
| `src/hooks/useTomorrowAssistProps.ts` | Modify | Use unified hook internally |

---

## Technical Details

### Key Bug Fixes:

1. **Correct prop_type values:**
   - Use `'threes'` instead of `'player_threes'`
   - Use `'assists'` instead of `'player_assists'`

2. **Correct UTC time boundaries:**
   - For Eastern date `2026-01-29`, query UTC `2026-01-30T00:00:00` to `2026-01-30T12:00:00`

3. **L5 Average calculation:**
   - Query `nba_player_game_logs` with correct field (`threes_made` or `assists`)
   - Sort by `game_date DESC` and take first 5 per player

### Expected Results After Fix:

For January 29th Eastern Time:
- **3PT Picks:** Anthony Edwards (O 3.5), Kevin Durant (O 2.5), Jaden Ivey (O 1.5), etc.
- **Assist Picks:** Cade Cunningham (O 9.5), Tyrese Maxey (O 7.5), etc.
- All with accurate live lines and calculated L5 averages
