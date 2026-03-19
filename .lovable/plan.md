

# Q1 Flip Logic + Q2 Decision Point

## Concept
Q1 data shows 75.5% of HEDGE ALERT props recovered — meaning Q1 negative signals are mostly noise. Instead of hedging in Q1, treat early warnings as **flip opportunities** (hold or even add exposure). Reserve real hedge decisions for Q2/halftime when signals stabilize.

## Changes

### 1. Widen Q1 Buffers — `getBufferThresholds`
**Files**: `src/lib/hedgeStatusUtils.ts` (line 14), `supabase/functions/hedge-live-telegram-tracker/index.ts` (line 18)

Current Q1: `{ onTrack: 4, monitor: 2, alert: -1 }`
New Q1: `{ onTrack: 2, monitor: -1, alert: -4 }`

This collapses Q1 into mostly HOLD territory. Only extreme cases (buffer < -4) hit HEDGE NOW. The middle ground (MONITOR/HEDGE ALERT) is nearly eliminated in Q1.

### 2. Remove Q1 Early `alert` Return in `calculateHedgeStatus`
**File**: `src/lib/hedgeStatusUtils.ts` (lines 62-77)

The Q1-aware early signal block currently returns `'alert'` when a player is below 40% of their Q1 FanDuel line. Change this to return `'monitor'` instead — since Q1 alerts are unreliable, downgrade them to monitor so they don't trigger hedge actions.

Similarly in `getHedgeActionLabel` (lines ~145-155), change the Q1 `'HEDGE ALERT'` returns to `'MONITOR'`.

### 3. Add "FLIP" Label for Q1 MONITOR Status
**File**: `src/lib/hedgeStatusUtils.ts`

Add a new export function `isQ1FlipCandidate(gameProgress, hedgeStatus)` that returns `true` when `gameProgress < 25` and status is `MONITOR` or `HEDGE ALERT`. UI/Telegram can use this to show "FLIP OPPORTUNITY" instead of a warning — signaling the user that Q1 dips are historically recoverable and could be exploited.

### 4. Telegram Tracker — Suppress Q1 Hedge Alerts
**File**: `supabase/functions/hedge-live-telegram-tracker/index.ts`

In the status-transition message logic, when `gameProgress < 25` and the new status is `MONITOR` or `HEDGE ALERT`, either skip sending or reword the message to: "Q1 dip detected — historically 75% recover. HOLD or consider flip."

Only send Q1 Telegram alerts for `HEDGE NOW` (extreme cases).

### Summary of Behavior

| Quarter | MONITOR | HEDGE ALERT | HEDGE NOW |
|---------|---------|-------------|-----------|
| Q1 | "Flip opportunity" / suppress | Nearly impossible (buffer < -4) | Fires only on extreme miss |
| Q2+ | Normal escalation | Normal | Normal |

