

# Fix: Hedge Snapshots Only Recording Q1

## Root Cause (Two Issues)

**Issue 1 — Server-side (hedge-live-telegram-tracker):** Snapshots only record when `newQuarter` is true (`currentQuarter > prevQuarter`). The problem: after Q1 triggers and updates `last_quarter_sent = 1`, if the 5-minute cron fires again while still in Q1 it sets `last_quarter_sent = 1` again. But **when Q2 actually starts**, the condition `currentQuarter > prevQuarter` should be true (2 > 1). However, the tracker upsert at line 438-446 only happens inside the `if (statusChanged || newQuarter)` block — meaning if neither condition is met on the exact cron tick when the quarter changes, the snapshot is skipped entirely. More critically, the `last_quarter_sent` gets updated even when no snapshot is recorded because the tracker upsert includes `last_quarter_sent: currentQuarter` regardless.

**Issue 2 — Client-side (useHedgeStatusRecorder):** The quarter boundary windows are extremely narrow (Q2: 47-53% progress, Q3: 72-78%). If the user's browser isn't open during those 6% windows, snapshots are missed entirely. This hook is a backup but unreliable.

## Fix Plan

### 1. Server-side: Record snapshot on EVERY cron tick, not just quarter transitions
**File:** `supabase/functions/hedge-live-telegram-tracker/index.ts`

Move the `record-hedge-snapshot` call **outside** the `if (newQuarter)` block so it fires every time the cron processes a live pick. The edge function already handles deduplication via the composite unique constraint `(player_name, prop_type, line, quarter, analysis_date)`, so duplicate Q1 calls just upsert (update) with latest values — which is actually better since it captures the most recent status for that quarter.

Change: Remove the `if (newQuarter)` guard around the snapshot recording block (lines 366-392). Record on every live processing tick.

### 2. Server-side: Don't update `last_quarter_sent` unless a Telegram message was actually sent
**File:** `supabase/functions/hedge-live-telegram-tracker/index.ts`

Currently the tracker upsert at line 438 always sets `last_quarter_sent: currentQuarter`, which can "consume" the quarter transition even when no snapshot was recorded. Keep this field only for Telegram dedup — it shouldn't gate snapshot recording.

### 3. Client-side: Widen quarter boundaries as safety net
**File:** `src/hooks/useHedgeStatusRecorder.ts`

Widen the windows so the client-side recorder has a better chance of capturing data when the browser is open:
- Q1: 20-30% (was 22-28%)
- Q2: 45-55% (was 47-53%)  
- Q3: 70-80% (was 72-78%)
- Q4: 88-100% (was 92-100%)

### 4. Client-side: Add interval-based recording as fallback
**File:** `src/hooks/useHedgeStatusRecorder.ts`

Add a 60-second interval that records the current quarter for any live spot, regardless of progress window. This ensures that if the user has the app open during a game, snapshots are captured continuously. The server-side upsert deduplication handles any redundancy.

## Files Changed
| File | Change |
|------|--------|
| `supabase/functions/hedge-live-telegram-tracker/index.ts` | Record snapshot on every cron tick (remove `newQuarter` guard) |
| `src/hooks/useHedgeStatusRecorder.ts` | Widen boundaries + add 60s interval fallback |

## Expected Result
After these changes, every 5-minute cron tick during a live game will record/update a snapshot for every tracked prop at its current quarter. Combined with the widened client-side windows, Q2-Q4 snapshots will be reliably captured regardless of browser state.

