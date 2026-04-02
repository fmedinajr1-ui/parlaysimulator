

## Settle All Pending FanDuel Predictions

### Problem
861 pending predictions are stuck unsettled due to two bottlenecks in `fanduel-accuracy-feedback`:
1. **`limit(300)`** — only processes 300 records per run
2. **3-hour post-game guard** — skips events less than 3 hours after tip-off

For games from March 29–April 1, all games are long over, so the guard isn't the issue — the 300 limit is just not enough to chew through the backlog in scheduled runs.

### Plan

**Edit `supabase/functions/fanduel-accuracy-feedback/index.ts`:**

1. **Raise the query limit from 300 → 1000** to process more records per invocation
2. **Accept a `settle_all` body parameter** — when `true`, skip the 2-hour age filter and 3-hour post-game guard for records older than 6 hours, allowing a single manual invocation to blast through the entire backlog
3. **Extend the 7-day lookback to 14 days** when `settle_all` is true to catch any stragglers from March 29

**Then invoke the function manually** with `{ "settle_all": true }` to settle all 861 pending records in one shot and send the accuracy report to Telegram.

### Technical Details
- Add `const body = await req.json().catch(() => ({}))` at top
- When `body.settle_all === true`: remove the `lte('created_at', twoHoursAgo)` filter, set lookback to 14 days, increase limit to 1000, and relax the 3-hour post-game guard to 30 minutes (safety net for truly live games)
- No schema changes needed — just function logic
- Redeploy and invoke once manually

