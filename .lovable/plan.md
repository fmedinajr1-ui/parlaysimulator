
# Unified Accuracy Dashboard - Implementation Plan

## Overview

Create a single dashboard view that consolidates real-time hit rates from all prediction systems: **3PT Shooters**, **Whale Proxy**, **Sweet Spots (Category Props)**, and **Lock Mode** - providing a unified accuracy report card with drill-down capabilities.

---

## Data Sources Analysis

### Current Accuracy Data Available

| System | Table | Outcome Column | Settled Count |
|--------|-------|----------------|---------------|
| Sweet Spots | `category_sweet_spots` | `outcome` (hit/miss/push) | 271 settled |
| 3PT Shooters | `category_sweet_spots` (category = THREE_POINT_SHOOTER) | `outcome` | 49 settled (93.9% hit rate) |
| Whale Proxy | `whale_picks` | `outcome` (hit/miss/push/pending/no_data) | 0 settled (38 pending) |
| Lock Mode | `scout_prop_outcomes` | `outcome` | 0 settled (357 pending) |
| Lock Mode Backtest | `lock_mode_backtest_runs` / `lock_mode_backtest_slips` | `legs_hit/missed` | Historical data |

### Existing RPC Functions
- `get_sweet_spot_accuracy()` - Category-level accuracy
- `get_category_hit_rates()` - Per-category hit rates
- `get_complete_accuracy_summary()` - Multi-system rollup

---

## Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│              UNIFIED ACCURACY DASHBOARD                          │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  OVERALL ACCURACY SCORE  - Weighted composite grade        │  │
│  │  [A/B/C Grade] [XX.X%] [Trend Arrow] [vs Breakeven]        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐        │
│  │ 3PT       │ │ Whale     │ │ Sweet     │ │ Lock      │        │
│  │ Shooters  │ │ Proxy     │ │ Spots     │ │ Mode      │        │
│  │  93.9%    │ │  --%      │ │  75.2%    │ │  --%      │        │
│  │  49 picks │ │  0 settld │ │  271 pick │ │  0 settld │        │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘        │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  CATEGORY BREAKDOWN  (Accordion with drill-down)           │  │
│  │  - THREE_POINT_SHOOTER: 93.9% (46/49)                      │  │
│  │  - STAR_FLOOR_OVER: 88.6% (31/35)                          │  │
│  │  - ROLE_PLAYER_REB: 83.6% (46/55)                          │  │
│  │  - LOW_SCORER_UNDER: 80.0% (40/50)                         │  │
│  │  ... more categories                                        │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  RECOMMENDATIONS  (Auto-generated trust/caution/avoid)     │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Implementation Details

### 1. New Database RPC Function

Create `get_unified_system_accuracy()` to aggregate all systems:

```sql
CREATE OR REPLACE FUNCTION get_unified_system_accuracy()
RETURNS TABLE(
  system_name TEXT,
  display_name TEXT,
  icon TEXT,
  total_picks BIGINT,
  verified_picks BIGINT,
  hits BIGINT,
  misses BIGINT,
  pushes BIGINT,
  hit_rate NUMERIC,
  sample_confidence TEXT,
  last_updated TIMESTAMPTZ
)
```

**Data aggregation per system:**

- **3PT Shooters**: Query `category_sweet_spots` WHERE `category = 'THREE_POINT_SHOOTER'`
- **Sweet Spots (All)**: Query `category_sweet_spots` (all categories)
- **Whale Proxy**: Query `whale_picks` WHERE `outcome IS NOT NULL`
- **Lock Mode**: Query `scout_prop_outcomes` WHERE `outcome IS NOT NULL`

### 2. New Hook: `useUnifiedAccuracy`

```typescript
// src/hooks/useUnifiedAccuracy.ts
interface SystemAccuracy {
  systemName: string;
  displayName: string;
  icon: string;
  totalPicks: number;
  verifiedPicks: number;
  hits: number;
  misses: number;
  pushes: number;
  hitRate: number;
  sampleConfidence: 'high' | 'medium' | 'low' | 'insufficient';
  lastUpdated: Date | null;
}

export function useUnifiedAccuracy() {
  // Fetch from new RPC
  // Calculate composite score
  // Return categorized data
}
```

### 3. New Page: Unified Accuracy Dashboard

Create `src/pages/AccuracyDashboard.tsx`:
- Lazy-loaded in App.tsx at route `/accuracy`
- Uses `AppShell` for consistent layout
- Pull-to-refresh support

### 4. Dashboard Components

**A. Main Component: `UnifiedAccuracyView.tsx`**
```typescript
// src/components/accuracy/UnifiedAccuracyView.tsx
// - Overall composite grade card (reuse AccuracyGradeCard)
// - System summary cards (4 cards in grid)
// - Category breakdown accordion
// - Recommendations section
```

**B. System Card: `SystemAccuracyCard.tsx`**
```typescript
// src/components/accuracy/SystemAccuracyCard.tsx
// - Icon + name
// - Hit rate (large, color-coded)
// - W-L-P record
// - Progress bar
// - Sample confidence badge
// - "Verify" button per system
```

**C. Time Period Selector**
```typescript
// Filter: 7d | 30d | 90d | All Time
// Updates all queries with date range
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/pages/AccuracyDashboard.tsx` | Page wrapper with AppShell |
| `src/components/accuracy/UnifiedAccuracyView.tsx` | Main dashboard layout |
| `src/components/accuracy/SystemAccuracyCard.tsx` | Per-system summary card |
| `src/components/accuracy/SystemCategoryBreakdown.tsx` | Drill-down by category |
| `src/hooks/useUnifiedAccuracy.ts` | Data fetching & aggregation |
| Database migration | New RPC function |

---

## Files to Modify

| File | Change |
|------|--------|
| `src/App.tsx` | Add lazy import + route for `/accuracy` |
| `src/components/BottomNav.tsx` | Optional: Add accuracy icon to nav |
| `src/lib/accuracy-calculator.ts` | Add system display names for new systems |

---

## UI/UX Features

### Visual Design
- **Grade Card**: Large letter grade (A+ through F) with color coding
- **System Cards**: Compact cards with emoji icons matching engine emojis
- **Color Coding**: Green (≥55%), Yellow (50-55%), Red (<50%)
- **Breakeven Line**: Visual marker at 52.4% on progress bars

### Interactive Features
- **Accordion Drill-down**: Click system to see category breakdown
- **Quick Verify**: Button to trigger outcome verification per system
- **Copy Stats**: Share accuracy stats as formatted text
- **Trend Indicators**: Up/down arrows for 30-day trends

---

## Technical Specifications

### System Icons & Colors

| System | Icon | Color |
|--------|------|-------|
| 3PT Shooters | 🏀 | `text-orange-400` |
| Whale Proxy | 🐋 | `text-blue-400` |
| Sweet Spots | ✨ | `text-purple-400` |
| Lock Mode | 🔒 | `text-emerald-400` |

### Sample Confidence Thresholds
- **High**: ≥100 verified picks
- **Medium**: 50-99 verified picks
- **Low**: 20-49 verified picks
- **Insufficient**: <20 verified picks

### Grade Calculation (Per System)
- A+: ≥60% with ≥100 samples
- A: ≥55% with ≥50 samples
- B+: ≥52% with ≥50 samples
- B: ≥50% with ≥25 samples
- C+: ≥47% with ≥25 samples
- C: ≥45%
- D: ≥40%
- F: <40%

---

## Route Integration

```typescript
// In App.tsx
const AccuracyDashboard = React.lazy(() => import("./pages/AccuracyDashboard"));

// In Routes
<Route path="/accuracy" element={<AccuracyDashboard />} />
```

---

## Expected Outcome

After implementation:
1. **Single View**: All system accuracies visible at a glance
2. **Real-Time**: Data refreshes on page load + manual refresh
3. **Actionable**: Recommendations for which systems to trust/avoid
4. **Drill-Down**: Expand any system to see category-level performance
5. **Trend Awareness**: 30-day trend indicators show improvement/decline

