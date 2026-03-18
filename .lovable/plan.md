

# Yesterday's Review + Tri-Signal Fix Plan

## Yesterday's Results (March 17)

**Parlays**: All 7 parlays were **voided** (L10-fresh rebuild). Zero settled wins or losses.

**Hedge Tracking**: Partially working but severely degraded:
- Only **13 hedge snapshots** captured, all at **Q1 only** (27.5% progress). No Q2, Q3, or Q4 snapshots recorded.
- Customer push notifications fired but with **zeros** for current_value and projected_final (e.g., "HEDGE NOW -- Brandon Miller: POINTS O14.5 -- Projected 0.0").

## Why Tri-Signal Only Worked Partially

Three root causes identified in `hedge-live-telegram-tracker/index.ts`:

1. **Book line never passed** (line 301): `liveBookLine: undefined` is hardcoded. The tracker never fetches live lines from `category_sweet_spots` or a lines API, so Signal 2 (45% weight in Q1) always falls back to zero, redistributing all weight to rate-only.

2. **Baseline FG% never passed** (line 303): `baselineFgPct: undefined` is hardcoded. Without L10 FG baseline, Signal 3 (FG regression) is always disabled. The tri-signal engine degrades to a single-signal rate projection with extra steps.

3. **Push notification data zeroed out** (lines 421-423): The `hedgePushAlerts` array hardcodes `currentValue: 0`, `projectedFinal: 0`, `gameProgress: 0` instead of passing the actual computed values from the loop above.

4. **Snapshots only at Q1**: The `record-hedge-snapshot` edge function or client-side `useHedgeStatusRecorder` only triggered once. Likely the cron missed later quarters or the quarter-transition detection didn't fire subsequent snapshots.

## Plan

### 1. Wire live book lines into Telegram tracker
**File**: `supabase/functions/hedge-live-telegram-tracker/index.ts`

Query `category_sweet_spots` for `recommended_line` as a fallback book anchor, and also fetch live lines from the `fanduel_odds` table (if player has a matching row for today). Pass `liveBookLine` into `triSignalProjection()`.

### 2. Compute baseline FG% from game logs
**File**: `supabase/functions/hedge-live-telegram-tracker/index.ts`

For scoring props (points/threes), query `nba_player_game_logs` L10 to calculate average FG% per player. Pass as `baselineFgPct` into `triSignalProjection()`.

### 3. Fix push notification data passthrough
**File**: `supabase/functions/hedge-live-telegram-tracker/index.ts`

Replace hardcoded zeros in `hedgePushAlerts` with actual `currentValue`, `projectedFinal`, `gameProgress`, and `currentQuarter` from the live processing loop.

### 4. Fix snapshot recording to fire every quarter
**File**: `supabase/functions/hedge-live-telegram-tracker/index.ts`

After processing live updates, call `record-hedge-snapshot` for each tracked player at every quarter boundary (not just Q1). The tracker already has `last_quarter_sent` -- use it to trigger snapshot recording when quarter changes.

### 5. Fix build errors
**Files**: `src/App.tsx`, `src/components/admin/MovementAccuracyDashboard.tsx`, `src/components/admin/SiteAnalyticsDashboard.tsx`

Pre-existing type errors with recharts JSX components and QueryClient import. These need TypeScript casts or version alignment fixes.

## Files to Change
| File | Change |
|------|--------|
| `supabase/functions/hedge-live-telegram-tracker/index.ts` | Wire live lines, baseline FG%, fix push data, add per-quarter snapshots |
| `src/App.tsx` | Fix QueryClient import |
| `src/components/admin/MovementAccuracyDashboard.tsx` | Fix recharts type errors |
| `src/components/admin/SiteAnalyticsDashboard.tsx` | Fix recharts type errors |

