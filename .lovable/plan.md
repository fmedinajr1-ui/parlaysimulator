

# Fix Whale Odds Scraper: API Key Returns 401

## Root Cause Found

The `whale-odds-scraper` has been **silently failing since March 16**. Every full run makes API calls but collects **0 props and 0 team bets**.

**Logs show the problem:**
```
[Full] Props batch failed for ee838160...: 401
[Full] Props batch failed for ee838160...: 401
[Full] Props batch failed for b542245530...: 422
```

The Odds API is returning **401 Unauthorized** on all player prop and team market endpoints. The events endpoint (listing games) still works, so the scraper finds games but can't fetch any odds data.

This is why:
- `game_bets` has been empty since March 15 (last successful full run)
- `unified_props` only has data because `pp-props-scraper` is a separate backup source
- Every parlay run falls back to the `game_bets stale` path

## The Fix: Two Parts

### Part 1: API Key — You Need to Check/Replace It

The `THE_ODDS_API_KEY` secret is either:
- **Expired** (monthly/annual subscription lapsed)
- **Hit its quota** (The Odds API has monthly request limits; your plan may have renewed by now)
- **Revoked** (unlikely but possible)

**Action needed from you**: Go to [The Odds API dashboard](https://the-odds-api.com/) and check your API key status. If it's expired or over quota, get a new key and I'll update the secret.

### Part 2: Code Fix — Better Error Handling

The current code silently swallows 401 errors per-batch. If the API key is bad, it should:
1. Detect the first 401 and **stop immediately** (don't waste remaining budget)
2. Send a **Telegram alert**: "API key rejected — odds scraper disabled"
3. Log the failure to `cron_job_history` as `failed` instead of `completed`

Currently, a broken run logs as `status: completed` with `playerPropsCollected: 0`, which looks like "no data available" rather than "authentication failed."

**File**: `supabase/functions/whale-odds-scraper/index.ts`

Changes:
- After the first 401 response on a prop/team fetch, set a flag `apiKeyInvalid = true`
- Break out of the event loop immediately
- Log to cron_job_history with `status: 'auth_failed'`
- Send Telegram alert to admin
- Return error response instead of success with 0 data

### Part 3: Cron Job Fix

The every-30-min cron (job 75) runs `mode: "scout"` which only counts events — it never fetches data. The `mode: "full"` cron (job 76) only runs 3x/day at 14:00, 17:00, 22:00 UTC.

**Recommendation**: Change the scout cron to run every 2 hours instead of every 30 min (saves API calls), and add an additional full run at 18:00 UTC (2 PM ET, right before NBA games).

## Summary

| Issue | Status | Fix |
|-------|--------|-----|
| API key returning 401 | **User action needed** | Check/renew The Odds API key |
| Silent failure (logs "completed" with 0 data) | Code fix | Add 401 detection, Telegram alert, proper error status |
| Scout cron too frequent | Optional | Reduce from every 30min to every 2h |

## Files Changed

1. **`supabase/functions/whale-odds-scraper/index.ts`** — Add 401 detection, early abort, Telegram alert, proper error logging
2. **Secret check** — Verify `THE_ODDS_API_KEY` is valid (user action)

