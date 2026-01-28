

# Settled Picks Table - Implementation Plan

## Overview

Add a comprehensive table to the Accuracy Dashboard (`/accuracy`) that displays all settled picks with player name, date, category, prop type, line, actual score, and outcome for complete transparency and analysis.

---

## Current Data Available

From the database query, we have **358+ settled picks** with the following structure:

| Field | Description | Example |
|-------|-------------|---------|
| `player_name` | Player name | Luka Doncic |
| `analysis_date` | Game date | 2026-01-26 |
| `category` | Pick category | STAR_FLOOR_OVER |
| `prop_type` | Stat type | points, rebounds, assists, threes |
| `recommended_side` | Over/Under | over |
| `actual_line` | Betting line | 33.5 |
| `actual_value` | Final stat value | 46 |
| `outcome` | Result | hit, miss, push |
| `l10_hit_rate` | L10 historical rate | 1.0 (100%) |
| `confidence_score` | Confidence | 0.83 |

**Note**: Team data is not directly stored in `category_sweet_spots`, but we can derive it from the opponent in `nba_player_game_logs` if needed.

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────┐
│           ACCURACY DASHBOARD - SETTLED PICKS TABLE                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  FILTERS:   [All Categories ▼] [All Props ▼] [All Outcomes ▼]      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Player       │ Date    │ Category    │ Pick       │ Result  │   │
│  ├──────────────┼─────────┼─────────────┼────────────┼─────────┤   │
│  │ Luka Doncic  │ Jan 26  │ Star Floor  │ PTS O33.5  │ 46 ✅   │   │
│  │ Coby White   │ Jan 26  │ Star Floor  │ PTS O20.5  │ 23 ✅   │   │
│  │ Jarrett Allen│ Jan 26  │ Big Reb     │ REB O8.5   │ 4 ❌    │   │
│  │ Ayo Dosunmu  │ Jan 26  │ 3PT Shooter │ 3PM O1.5   │ 2 ✅    │   │
│  │ ...          │ ...     │ ...         │ ...        │ ...     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Showing 50 of 358 picks   [Load More]                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### 1. New Component: SettledPicksTable

Create `src/components/accuracy/SettledPicksTable.tsx`:

```typescript
interface SettledPick {
  player_name: string;
  analysis_date: string;
  category: string;
  prop_type: string;
  recommended_side: string;
  line: number;
  score: number;
  outcome: 'hit' | 'miss' | 'push';
  l10_hit_rate: number;
  confidence_score: number;
}
```

**Features:**
- Sortable columns (date, player, outcome)
- Filters for category, prop type, and outcome
- Color-coded outcomes (green hit, red miss, yellow push)
- Compact mobile-friendly design
- Pagination with "Load More" button

### 2. New Hook: useSettledPicks

Create `src/hooks/useSettledPicks.ts`:

```typescript
export function useSettledPicks(filters: {
  category?: string;
  propType?: string;
  outcome?: string;
  limit?: number;
}) {
  // Query category_sweet_spots with filters
  // Return paginated settled picks
}
```

### 3. Update UnifiedAccuracyView

Add a new collapsible section below the Category Breakdown:

```tsx
<Card className="p-4 bg-card/50 border-border/50">
  <Collapsible>
    <CollapsibleTrigger className="flex items-center justify-between w-full">
      <h3 className="font-semibold flex items-center gap-2">
        <span>📋</span>
        Settled Picks ({totalSettled})
      </h3>
      <ChevronDown className="w-4 h-4" />
    </CollapsibleTrigger>
    <CollapsibleContent>
      <SettledPicksTable />
    </CollapsibleContent>
  </Collapsible>
</Card>
```

---

## UI/UX Design

### Table Columns (Mobile-Optimized)

| Column | Width | Content |
|--------|-------|---------|
| Player | 40% | Player name (truncated if long) |
| Date | 15% | MMM DD format |
| Pick | 25% | "PTS O33.5" format (prop + side + line) |
| Result | 20% | Score + outcome icon |

### Outcome Display

- **Hit**: `46 ✅` (green text)
- **Miss**: `4 ❌` (red text)
- **Push**: `4.5 ➖` (yellow text)

### Filter Chips

Horizontal scrollable chips for quick filtering:
- **Categories**: All, 3PT Shooters, Star Floor, Role Reb, etc.
- **Props**: All, Points, Rebounds, Assists, Threes
- **Outcomes**: All, Hits Only, Misses Only

### Category Display Names

Map database category names to user-friendly names:
```typescript
const CATEGORY_DISPLAY: Record<string, string> = {
  'THREE_POINT_SHOOTER': '3PT',
  'STAR_FLOOR_OVER': 'Star',
  'ROLE_PLAYER_REB': 'Role Reb',
  'BIG_REBOUNDER': 'Big Reb',
  'VOLUME_SCORER': 'Volume',
  'BIG_ASSIST_OVER': 'Big Ast',
  'LOW_SCORER_UNDER': 'Low U',
  // ... etc
};
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/accuracy/SettledPicksTable.tsx` | Main table component |
| `src/hooks/useSettledPicks.ts` | Data fetching hook with filters |

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/accuracy/UnifiedAccuracyView.tsx` | Add SettledPicksTable section |

---

## Query Details

### Supabase Query

```typescript
const { data, error } = await supabase
  .from('category_sweet_spots')
  .select(`
    player_name,
    analysis_date,
    category,
    prop_type,
    recommended_side,
    actual_line,
    actual_value,
    outcome,
    l10_hit_rate,
    confidence_score
  `)
  .in('outcome', ['hit', 'miss', 'push'])
  .order('analysis_date', { ascending: false })
  .order('player_name', { ascending: true })
  .limit(limit);
```

### With Filters

```typescript
let query = supabase.from('category_sweet_spots').select('...');

if (categoryFilter) {
  query = query.eq('category', categoryFilter);
}
if (propTypeFilter) {
  query = query.eq('prop_type', propTypeFilter);
}
if (outcomeFilter) {
  query = query.eq('outcome', outcomeFilter);
}
```

---

## Expected Outcome

After implementation, the Accuracy Dashboard will show:

1. **Complete Transparency**: Every settled pick visible with full details
2. **Quick Analysis**: Filter by category/prop to see specific performance
3. **Pattern Recognition**: Sort by outcome to see what's working
4. **Score Verification**: Actual values shown alongside lines for validation

---

## Sample Data Display

| Player | Date | Category | Pick | Result |
|--------|------|----------|------|--------|
| Luka Doncic | Jan 26 | Star | PTS O33.5 | 46 ✅ |
| Paolo Banchero | Jan 26 | Volume | PTS O23.5 | 37 ✅ |
| Coby White | Jan 26 | Star | PTS O20.5 | 23 ✅ |
| Coby White | Jan 26 | 3PT | 3PM O2.5 | 5 ✅ |
| Jarrett Allen | Jan 26 | Big Reb | REB O8.5 | 4 ❌ |
| Anfernee Simons | Jan 26 | Role Reb | REB O2.5 | 1 ❌ |
| Ayo Dosunmu | Jan 26 | 3PT | 3PM O1.5 | 2 ✅ |

