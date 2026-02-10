

# Fix UTC Date Bug Showing Feb 10 Instead of Feb 9

## Root Cause

The date mismatch comes from multiple sources:

1. **`bot_activation_status` has a `check_date: 2026-02-10` record** created at midnight UTC (7 PM EST Feb 9). This record is returned as the "latest" activation status on the dashboard, potentially confusing the display even though the parlay query itself filters correctly by Eastern date.

2. **`BotPerformanceChart` parses `check_date` strings with `new Date()` constructor**, which interprets "YYYY-MM-DD" as midnight UTC. In EST, that shifts back a day (e.g., `new Date("2026-02-10")` displays as "Feb 9" in EST, but `new Date("2026-02-09")` displays as "Feb 8"). This causes the chart x-axis to show wrong dates.

3. **Many files throughout the codebase still use `new Date().toISOString().split('T')[0]`** instead of `getEasternDate()`, causing UTC date bugs after 7 PM EST. While not all are on the /bot page, they affect other pages the user navigates to.

## Changes

### 1. Fix BotPerformanceChart date parsing
**File: `src/components/bot/BotPerformanceChart.tsx`**

Replace:
```typescript
date: new Date(day.check_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
```
With timezone-safe parsing that treats the date string as a local date (not UTC):
```typescript
date: (() => {
  const [y, m, d] = day.check_date.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
})()
```

### 2. Fix widespread `toISOString().split('T')[0]` usage (13 files)

Replace all instances of `new Date().toISOString().split('T')[0]` with `getEasternDate()` from `@/lib/dateUtils` in these files:

| File | Lines | Current |
|------|-------|---------|
| `src/hooks/useManualBuilder.ts` | 79, 126 | `new Date().toISOString().split("T")[0]` |
| `src/hooks/useHedgeStatusRecorder.ts` | 71 | `new Date().toISOString().split('T')[0]` |
| `src/pages/SportsFatigue.tsx` | 114 | `new Date().toISOString().split('T')[0]` |
| `src/components/admin/AIGenerativeProgressDashboard.tsx` | 475 | `new Date().toISOString().split('T')[0]` |
| `src/components/market/PropMarketWidget.tsx` | 67 | `new Date().toISOString().split('T')[0]` |
| `src/components/results/FatigueImpactCard.tsx` | 72 | `new Date().toISOString().split('T')[0]` |
| `src/components/results/SharpMoneyAlerts.tsx` | 70 | `new Date().toISOString().split('T')[0]` |
| `src/hooks/useSmartAnalyze.ts` | 126 | `new Date().toISOString().split('T')[0]` |
| `src/pages/SharpMoney.tsx` | 120 | `new Date().toISOString().split('T')[0]` |
| `src/components/suggestions/DailyEliteHitterCard.tsx` | 299, 327 | `new Date().toISOString().split('T')[0]` |
| `src/components/suggestions/MedianEdgePicksCard.tsx` | 374 | `new Date().toISOString().split('T')[0]` |
| `src/components/sharp/SharpParlayCard.tsx` | 170 | `new Date().toISOString().split('T')[0]` |
| `src/components/suggestions/CategoryPropsCard.tsx` | 275 | `new Date().toISOString()` (for commence_time filter) |

Each file will import `getEasternDate` from `@/lib/dateUtils` and use it instead.

### 3. Fix date-string parsing across components

Any component that creates a `Date` object from a "YYYY-MM-DD" string (like `new Date("2026-02-10")`) risks a timezone shift. These will be updated to parse components manually:

```typescript
// Before (UTC midnight = wrong day in EST):
new Date(dateStr).toLocaleDateString(...)

// After (local date, no shift):
const [y, m, d] = dateStr.split('-').map(Number);
new Date(y, m - 1, d).toLocaleDateString(...)
```

## Summary

- 1 chart fix for date axis labels
- 13+ files converted from UTC `toISOString()` to Eastern-aware `getEasternDate()`
- Consistent date-string parsing to prevent timezone shift artifacts
