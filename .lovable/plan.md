
# Fix Accuracy Display and Remove Parlay Auth Requirement

## Overview
This plan addresses two main issues:
1. **Accuracy problems**: Wrong percentages, missing data, incorrect grades, hit rates not updating, and player names with props not displaying correctly
2. **Auth requirement**: Remove sign-in requirement for viewing parlays on the home page

---

## Part 1: Remove Sign-In Requirement for Viewing Parlays

### Current Problem
On the Index page (`src/pages/Index.tsx`), parlays and related content are wrapped in auth checks:
```tsx
{(isPilotUser || isSubscribed || isAdmin) && (
  <div className="mb-4">
    <DailyParlayHub />
  </div>
)}
```
This hides all parlay content from non-authenticated users.

### Solution
Remove the auth conditionals from parlay display components on the Index page, making them publicly viewable:

| File | Change |
|------|--------|
| `src/pages/Index.tsx` | Remove `(isPilotUser \|\| isSubscribed \|\| isAdmin) &&` conditionals from: DailyParlayHub, Elite3PTFixedParlay, SweetSpotPicksCard, WeeklyParlayHistory, and SlateRefreshControls |

---

## Part 2: Fix Accuracy Display Issues

### Issue 2.1: Wrong Percentages and Hit Rates
The accuracy data from `get_unified_system_accuracy` RPC is correct (e.g., 63.2% for 3PT Shooters), but UI components may have type coercion issues.

**Files to audit:**
| File | Issue | Fix |
|------|-------|-----|
| `src/hooks/useUnifiedAccuracy.ts` | Hit rate from DB is already a percentage | Ensure no double multiplication (e.g., `hitRate * 100`) |
| `src/components/accuracy/SystemAccuracyCard.tsx` | Displays `system.hitRate` directly | Already correct - no multiplication needed |
| `src/components/accuracy/CompositeGradeCard.tsx` | Check percentage display logic | Audit for double calculation |

### Issue 2.2: Missing Accuracy Data
Some systems show "N/A" or "Needs Data" when they should have values. The RPC shows:
- `whale_proxy`: 0 verified picks, hit_rate: null
- `lock_mode`: 0 verified picks, hit_rate: null
- `matchup_scanner_pts/3pt`: 0 picks each

**Root Cause:** These systems have no verified/settled picks in `scout_prop_outcomes` table within the selected time period.

**Fix:** This is expected behavior - systems with no settled picks cannot show accuracy. However, we can improve the UI messaging:

| File | Change |
|------|--------|
| `src/components/accuracy/SystemAccuracyCard.tsx` | Add clearer "0 verified picks" message instead of just "Needs Data" |

### Issue 2.3: Wrong Grade Calculations
The `calculateGrade` function in `src/lib/accuracy-calculator.ts` uses correct thresholds:
- A+: >=60% with >=100 samples
- A: >=55% with >=50 samples
- N/A: <10 samples

**Potential issue:** Grades not updating when data changes. This could be a React Query caching issue.

| File | Change |
|------|--------|
| `src/hooks/useUnifiedAccuracy.ts` | Add `refetchOnMount: true` to ensure fresh data on page load |

### Issue 2.4: Player Names with Props Display
Parlay cards display player info using leg data. Issues can occur when:
- `player_name` is undefined or an object instead of string
- `prop_type` is missing

**Files to fix:**
| File | Change |
|------|--------|
| `src/components/parlays/UnifiedParlayCard.tsx` | Add null checks: `leg.playerName ?? 'Unknown Player'` |
| `src/components/bot/BotParlayCard.tsx` | Add null checks: `leg.player_name ?? 'Unknown Player'` |
| `src/hooks/useDailyParlays.ts` | Ensure legs are properly typed and validated |

---

## Technical Implementation Details

### File 1: `src/pages/Index.tsx`
Remove auth conditionals to make parlays public:

```tsx
// BEFORE:
{(isPilotUser || isSubscribed || isAdmin) && (
  <div className="mb-4">
    <SlateRefreshControls />
  </div>
)}

// AFTER:
<div className="mb-4">
  <SlateRefreshControls />
</div>
```

Apply same change to:
- `<Elite3PTFixedParlay />`
- `<DailyParlayHub />`
- `<SweetSpotPicksCard />`
- `<WeeklyParlayHistory />`

### File 2: `src/hooks/useUnifiedAccuracy.ts`
Add refetch options for fresh data:

```tsx
const { data, isLoading, error, refetch } = useQuery({
  queryKey: ['unified-accuracy', daysBack],
  queryFn: async () => { ... },
  staleTime: 1000 * 60 * 5,
  gcTime: 1000 * 60 * 30,
  refetchOnMount: true, // ADD THIS
  refetchOnWindowFocus: true, // ADD THIS
});
```

### File 3: `src/components/parlays/UnifiedParlayCard.tsx`
Add null safety for player display:

```tsx
function LegRow({ leg, index }: { leg: UnifiedParlayLeg; index: number }) {
  const playerName = leg.playerName ?? 'Unknown';
  const propType = leg.propType ?? 'Prop';
  // ...
  return (
    <div>
      <span className="font-medium">{playerName}</span>
      <span className="text-muted-foreground ml-1">{propType}</span>
    </div>
  );
}
```

### File 4: `src/components/bot/BotParlayCard.tsx`
Add null safety:

```tsx
{legs.map((leg, idx) => {
  const playerName = leg.player_name ?? 'Unknown';
  const propType = leg.prop_type ?? 'Prop';
  // ...
})}
```

### File 5: `src/components/accuracy/SystemAccuracyCard.tsx`
Improve empty state messaging:

```tsx
{system.verifiedPicks === 0 ? (
  <span className="text-muted-foreground">No data yet</span>
) : (
  <span className={cn("text-lg font-bold", getHitRateColor())}>
    {system.hitRate}%
  </span>
)}
```

---

## Files Changed Summary

| File | Changes |
|------|---------|
| `src/pages/Index.tsx` | Remove auth conditionals from 5 components |
| `src/hooks/useUnifiedAccuracy.ts` | Add refetch options |
| `src/components/parlays/UnifiedParlayCard.tsx` | Add null safety for player/prop display |
| `src/components/bot/BotParlayCard.tsx` | Add null safety for leg display |
| `src/components/accuracy/SystemAccuracyCard.tsx` | Improve empty state messaging |

---

## Expected Results

After implementation:
1. All users (logged in or not) can view daily parlays, elite picks, sweet spot picks, and weekly history
2. Accuracy percentages display correctly without double multiplication
3. Player names and props always show (with fallbacks for missing data)
4. Grades update properly when new data is available
5. Systems with no verified picks show clear "No data yet" messaging
