
# Create Tomorrow's 3PT Picks Page

## Overview

Create a dedicated page at `/tomorrow-3pt` that displays all 3-point shooter props for the next day's games, showing L10 hit rates, confidence scores, and team diversity information.

---

## Files to Create

### 1. New Page Component
**File:** `src/pages/Tomorrow3PT.tsx`

A dedicated page component that:
- Fetches 3PT shooter picks from `category_sweet_spots` for tomorrow's date
- Displays a filterable, sortable list of all 3PT props
- Shows L10 hit rate, confidence score, projected value, and edge
- Includes team badges and reliability indicators
- Provides a "Refresh Tomorrow's Props" button to trigger the category analyzer

Key features:
- Date selector to toggle between tomorrow and future dates
- Filter by hit rate tiers (100%, 97%+, 90%+, All)
- Sort by L10 hit rate, confidence, or edge
- "Add to Builder" button for individual picks
- Summary stats (total picks, elite count, unique teams)

### 2. New Hook for Tomorrow's Data
**File:** `src/hooks/useTomorrow3PTProps.ts`

A custom hook that:
- Calculates tomorrow's Eastern date
- Fetches `category_sweet_spots` with `category = 'THREE_POINT_SHOOTER'`
- Joins with `player_reliability_scores` for tier badges
- Joins with `bdl_player_cache` for team data
- Returns picks sorted by L10 hit rate descending

```typescript
interface Tomorrow3PTPick {
  id: string;
  player_name: string;
  prop_type: string;
  recommended_line: number;
  actual_line: number | null;
  l10_hit_rate: number;
  confidence_score: number;
  projected_value: number | null;
  team: string;
  reliabilityTier: string | null;
  analysis_date: string;
}
```

---

## Route Registration

### Update `src/App.tsx`

Add the new route alongside other market pages:

```typescript
import Tomorrow3PT from "./pages/Tomorrow3PT";

// In AnimatedRoutes:
<Route path="/tomorrow-3pt" element={<Tomorrow3PT />} />
```

### Update `src/components/PilotRouteGuard.tsx`

Add `/tomorrow-3pt` to `PILOT_ALLOWED_ROUTES`:

```typescript
const PILOT_ALLOWED_ROUTES = [
  // ... existing routes
  '/tomorrow-3pt',
];
```

---

## UI Design

### Header Section
```text
[Back] 🎯 Tomorrow's 3PT Picks
        Tuesday, Jan 28, 2026

[Date Picker] [Refresh Props]
```

### Summary Stats Bar
```text
28 Players | 15 Elite (100% L10) | 12 Teams | Avg 98.2% Hit Rate
```

### Filter Controls
```text
[100% L10] [97%+] [90%+] [All]  |  Sort: [L10 ▼] [Conf] [Edge]
```

### Pick Cards (Grid Layout)
Each card shows:
- Player name + Team badge
- O 0.5 line with side indicator
- L10 hit rate (large, color-coded)
- Confidence score
- Reliability tier badge (Elite/Reliable/NEW)
- Edge if available
- "Add" button

---

## Implementation Details

### Date Calculation
```typescript
function getTomorrowEasternDate(): string {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
```

### Query Structure
```typescript
const { data, error } = await supabase
  .from('category_sweet_spots')
  .select('*')
  .eq('analysis_date', tomorrowDate)
  .eq('category', 'THREE_POINT_SHOOTER')
  .order('l10_hit_rate', { ascending: false });
```

### Color Coding for Hit Rates
| Hit Rate | Color | Badge |
|----------|-------|-------|
| 100% | Green | Elite |
| 97-99% | Emerald | Near Perfect |
| 90-96% | Yellow | Strong |
| Below 90% | Gray | Standard |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/Tomorrow3PT.tsx` | **CREATE** - New page component |
| `src/hooks/useTomorrow3PTProps.ts` | **CREATE** - Data fetching hook |
| `src/App.tsx` | Add route for `/tomorrow-3pt` |
| `src/components/PilotRouteGuard.tsx` | Add to allowed routes |
| `src/components/layout/MenuDrawer.tsx` | Add navigation link (optional) |

---

## User Flow

1. User navigates to `/tomorrow-3pt` (or clicks link from home/sidebar)
2. Page loads tomorrow's 3PT shooter picks from category analyzer
3. User sees all players with their L10 hit rates prominently displayed
4. User can filter by hit rate tier (100%, 97%+, etc.)
5. User can click "Add" on individual picks to add to parlay builder
6. If no data exists, user can click "Refresh" to trigger the category analyzer for tomorrow's slate

---

## Empty State

When no picks are available:
```text
No 3PT picks analyzed for tomorrow yet

The Category Analyzer will populate tomorrow's slate 
when games are scheduled and prop lines are available.

[Refresh Tomorrow's Props]
```
