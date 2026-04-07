

# Fix Pending Gold Signal Settlement

## Problem

Two separate issues are causing gold signals to show as "pending":

1. **Today's 10 gold signals** — These are from tonight's games (7-8 PM ET tip-offs). The feedback loop correctly waits 3 hours after game start before settling. These will auto-resolve on the next run. **No fix needed.**

2. **4 older signals stuck since March 29-April 5** — These have plenty of timeline data (289+ snapshots each) but the settlement logic can't resolve them because `signal_factors` is missing the expected keys (`line_to`, `currentLine`, `current_line`). The `resolveLineAtSignal()` function returns null, and the settlement short-circuits with no outcome.

## Root Cause

The `fanduel-accuracy-feedback` function settles cascade/velocity_spike signals by comparing the line at signal time vs closing line. When `signal_factors` doesn't contain an explicit line value, it falls back to finding the nearest timeline snapshot — but if `player_name` matching is slightly off or the fallback still returns null, the signal stays permanently pending.

## Fix

**Edit `supabase/functions/fanduel-accuracy-feedback/index.ts`:**

1. **Add a stale signal sweeper** at the end of the main loop — any signal older than 48 hours that still has `was_correct IS NULL` and has timeline data gets force-settled using pure timeline CLV (opening vs closing snapshot). If no timeline match exists, mark as `unverifiable` so it stops clogging the queue.

2. **Improve `resolveLineAtSignal()` fallback** — when `signal_factors` keys are missing, parse the `prediction` text to extract the line value (e.g., "OVER 6.5" → 6.5, "FADE -235" → -235).

3. **Add team-name fuzzy matching** for timeline lookups — normalize accented characters (e.g., "Montréal" → "Montreal") to prevent silent mismatches on NHL teams.

## Technical Details

- Stale threshold: 48 hours after `created_at`
- Force-settle logic: compare first and last timeline snapshots for the player+prop combo; if closing moved in predicted direction → correct, otherwise → incorrect
- Unverifiable cleanup: signals with 0 timeline rows after 72 hours get marked `was_correct = null, actual_outcome = 'unverifiable'` to exclude from accuracy calculations
- No new tables or migrations needed

