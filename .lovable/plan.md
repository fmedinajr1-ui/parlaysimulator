
# Implementation Plan: Today's Assist Plays with Accurate Lines & L5 Averages

## Problem Summary

The current "Tomorrow's Assist Plays" page has three critical data issues:
1. **Missing categories** - Only shows `BIG_ASSIST_OVER` and `HIGH_ASSIST_UNDER` (8 picks), but most assist picks are in `HIGH_ASSIST` (39 picks) and `ASSIST_ANCHOR` (4 picks)
2. **Placeholder lines** - Displays `recommended_line` (2.5-3.5) instead of actual sportsbook lines (7.5, 9.5, 5.5)
3. **No L5 data** - Missing last 5 games average for comparison

## Data Verification (Jan 29th Slate)

| Player | Actual Line | L10 Avg | L5 Avg (calculated) | L10 Hit Rate |
|--------|-------------|---------|---------------------|--------------|
| Tyrese Maxey | 7.5 | 8.2 | TBD | 100% |
| Cade Cunningham | 9.5 | 9.2 | 9.8 (11,11,11,8,8) | 100% |
| Coby White | 5.5 | 5.4 | TBD | 100% |
| LaMelo Ball | 6.5 | 6.3 | TBD | 90% |

---

## Implementation Steps

### Step 1: Create `useTodayAssistProps.ts` Hook

A new dedicated hook for today's slate with proper data enrichment:

**Key Changes:**
- Use `getEasternDate()` from `@/lib/dateUtils` for today's date
- Expand categories: `['BIG_ASSIST_OVER', 'HIGH_ASSIST_UNDER', 'HIGH_ASSIST', 'ASSIST_ANCHOR']`
- Fetch live lines from `unified_props` where `prop_type = 'player_assists'`
- Query `nba_player_game_logs` to calculate L5 average assists
- Add `l5_avg` and enhanced `actual_line` to the pick interface

**Data Flow:**
```text
unified_props (today)     ──► activePlayers Set
                                    │
category_sweet_spots      ──► Filter by Set ──► Raw Picks
                                    │
unified_props (lines)     ──► linesMap ───────► Merge Live Lines
                                    │
nba_player_game_logs (L5) ──► l5Map ──────────► Add L5 Avg
                                    │
                                    ▼
                              Final Picks with accurate data
```

### Step 2: Update `TomorrowAssistPick` Interface

Add new field:
```typescript
l5_avg: number | null;  // Last 5 games average
```

### Step 3: Update `TomorrowAssists.tsx` UI

- Display both L5 and L10 averages side-by-side
- Fix the page title/header dynamically based on analysis date

**Updated Stats Display:**
```text
┌─────────────────────────────────────────┐
│ Cade Cunningham                    100% │
│ DET  •  Over                     L10 HR │
├─────────────────────────────────────────┤
│ Line: O 9.5          L5: 9.8   L10: 9.2 │
│                      Conf: 75%          │
└─────────────────────────────────────────┘
```

---

## Technical Implementation Details

### Hook Logic (useTomorrowAssistProps.ts)

```typescript
// 1. Expand categories
query = query.in('category', [
  'BIG_ASSIST_OVER', 
  'HIGH_ASSIST_UNDER', 
  'HIGH_ASSIST', 
  'ASSIST_ANCHOR'
]);

// 2. Fetch live lines from unified_props
const { data: liveLines } = await supabase
  .from('unified_props')
  .select('player_name, current_line')
  .eq('prop_type', 'player_assists')
  .gte('commence_time', `${startOfToday}`)
  .lt('commence_time', `${endOfToday}`);

const linesMap = new Map();
liveLines?.forEach(p => {
  linesMap.set(p.player_name.toLowerCase(), p.current_line);
});

// 3. Calculate L5 averages from game logs
const playerNames = filteredSpots.map(p => p.player_name);

const { data: gameLogs } = await supabase
  .from('nba_player_game_logs')
  .select('player_name, assists, game_date')
  .in('player_name', playerNames)
  .order('game_date', { ascending: false })
  .limit(playerNames.length * 5);

// Group by player and calculate L5 avg
const l5Map = new Map();
const grouped = {};
gameLogs?.forEach(log => {
  const key = log.player_name.toLowerCase();
  if (!grouped[key]) grouped[key] = [];
  if (grouped[key].length < 5) grouped[key].push(log.assists);
});
Object.entries(grouped).forEach(([name, assists]) => {
  const avg = assists.reduce((s, a) => s + a, 0) / assists.length;
  l5Map.set(name, avg);
});

// 4. Merge into pick transformation
return {
  ...pick,
  actual_line: linesMap.get(playerKey) ?? pick.actual_line ?? pick.recommended_line,
  l5_avg: l5Map.get(playerKey) ?? null,
};
```

### UI Changes (TomorrowAssists.tsx)

```tsx
<div className="flex items-center gap-3 text-sm">
  {pick.l5_avg !== null && (
    <div className="text-center">
      <p className="text-xs text-muted-foreground">L5</p>
      <p className="font-semibold">{pick.l5_avg.toFixed(1)}</p>
    </div>
  )}
  {pick.l10_avg !== null && (
    <div className="text-center">
      <p className="text-xs text-muted-foreground">L10</p>
      <p className="font-semibold">{pick.l10_avg.toFixed(1)}</p>
    </div>
  )}
  <div className="text-center">
    <p className="text-xs text-muted-foreground">Conf</p>
    <p className="font-semibold">{(pick.confidence_score * 100).toFixed(0)}%</p>
  </div>
</div>
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useTomorrowAssistProps.ts` | Expand categories, fetch live lines, calculate L5 avg |
| `src/pages/TomorrowAssists.tsx` | Display L5 avg, update UI layout |

## Expected Results After Implementation

For January 29th slate, the page will show:

**Elite Tier (100% L10):**
- Tyrese Maxey - O 7.5 - L5: X.X - L10: 8.2
- Cade Cunningham - O 9.5 - L5: 9.8 - L10: 9.2
- Coby White - O 5.5 - L5: X.X - L10: 5.4
- James Harden - O X.X - L5: X.X - L10: 8.7
- LeBron James, Derrick White, Pascal Siakam, etc.

**High Tier (90% L10):**
- LaMelo Ball - O 6.5 - L5: X.X - L10: 6.3
- Aaron Gordon, Giannis Antetokounmpo
