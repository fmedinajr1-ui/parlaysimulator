# Restore Take It Now settlement

Take It Now alerts stopped grading on April 14. 8,330 alerts are unsettled, so the Telegram recap and accuracy cache can't show recent wins. This plan restores grading and keeps it running.

## What to build

1. **New edge function `take-it-now-settler`**
   - Pulls unsettled `fanduel_prediction_alerts` where `signal_type = 'take_it_now'` and `commence_time < now() - interval '4 hours'`.
   - Joins to `prop_results_archive` on `player_name + prop_type + event_id` (with date fallback) to determine actual outcome.
   - For props missing in archive, falls back to `*_player_game_logs` for the relevant sport.
   - Writes the result two places:
     - Updates `fanduel_prediction_alerts.was_correct`, `actual_outcome`, `settled_at`, `settlement_method`.
     - Inserts a row into `fanduel_prediction_accuracy` with the same signal context (line_at_alert, edge, drift, etc.) so the existing accuracy cache picks it up.
   - Idempotent: skip alerts already settled. Batched at 500/run to stay under the timeout.

2. **Backfill mode**
   - Same function accepts `{ mode: "backfill", since: "2026-04-15" }` and runs the same logic over the full unsettled window in chunks. We invoke it manually once to clear the backlog.

3. **Cron**
   - Schedule `take-it-now-settler` every 30 minutes via `pg_cron` + `pg_net` (same pattern as existing settlers).

4. **Telegram recap hook**
   - Update the existing recap query that surfaces "Recent TIN wins" to read from `fanduel_prediction_accuracy` filtered by `signal_type='take_it_now'` and `verified_at > now() - interval '7 days'`, ordered by `verified_at desc`.
   - No new channel; this reuses the existing recap path.

5. **Monitoring**
   - Add a non-fatal admin alert if `take-it-now-settler` finds zero gradeable rows for 24h (matches existing pipeline-monitoring pattern).

## Out of scope

- Re-grading TIN alerts before March 29 (no archive coverage).
- Changing TIN generation/gating logic itself.
- Touching `model_intel_*` (AI Models pipeline stays isolated).

## Verification (5 tests, per project rule)

1. Dry-run on 10 known-settled April alerts; expect identical `was_correct` to existing rows.
2. Backfill April 15 → May 20; row count in `fanduel_prediction_accuracy` for `take_it_now` jumps by thousands.
3. Per-day win% query returns non-empty for last 7 days.
4. Cron run logs show `settled_count > 0` and no errors.
5. Telegram recap renders "Recent TIN wins" with at least one entry from the last 48h.
