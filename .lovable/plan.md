

# Pre-Generation Pipeline Health Check

## Overview
Add a new `bot-pipeline-preflight` edge function that runs automatically before every parlay generation cycle. It performs critical checks on data freshness, API health, and pipeline integrity -- then stores results in `bot_activity_log` and fires a Telegram alert if anything is broken. On the frontend, the `SlateRefreshControls` component and a new `usePipelinePreflight` hook will surface these issues as urgent toast messages so you can catch problems before they produce bad parlays.

---

## What Gets Checked (8 Pre-Flight Gates)

| # | Check | Pass | Fail |
|---|-------|------|------|
| 1 | **Odds freshness** | `unified_props` has 50+ rows for today | Stale or missing odds |
| 2 | **Game log freshness** | `nba_player_game_logs` has data within last 5 days | Stats fetcher is broken |
| 3 | **API budget** | `api_budget_tracker` has 200+ calls remaining | Budget exhausted |
| 4 | **Sweet spots exist** | `category_sweet_spots` has rows for today | Analyzer failed |
| 5 | **Whale signals exist** | `game_bets` has rows updated today | Whale detector failed |
| 6 | **Recent cron success** | Last `data-pipeline-orchestrator` run in `cron_job_history` was not `failed` | Pipeline crashed |
| 7 | **Stale props cleaned** | No `unified_props` older than 48h with today's game date | Cleanup missed |
| 8 | **Integrity check** | No 1-leg or 2-leg parlays from last run | Generator bug |

---

## Implementation

### New Edge Function: `supabase/functions/bot-pipeline-preflight/index.ts`

- Runs all 8 checks against the database
- Returns a JSON response with `{ ready: boolean, checks: CheckResult[], blockers: string[] }`
- If `ready === false`, fires a Telegram alert via `bot-send-telegram` with type `preflight_alert` (bypasses quiet hours)
- Logs results to `bot_activity_log` with event_type `preflight_check`
- Designed to complete in under 2 seconds (all queries are simple count/select)

### Pipeline Integration: `supabase/functions/data-pipeline-orchestrator/index.ts`

- Add a preflight call at the top of PHASE 3 (PARLAY GENERATION), right before `whale-odds-scraper targeted`:
```
// Before generation, run preflight health check
const preflightOk = await runFunction('bot-pipeline-preflight', {});
if (!preflightOk) {
  console.warn('[Pipeline] Preflight failed -- generation will proceed with warnings');
}
```
- The pipeline continues even if preflight fails (no hard block), but the alert ensures you know something is wrong

### Frontend Hook: `src/hooks/usePipelinePreflight.ts`

- Queries `bot_activity_log` for the most recent `preflight_check` event
- Returns `{ isHealthy, blockers, lastCheckTime, refetch }`
- Uses React Query with 60-second polling (`refetchInterval: 60000`) to keep status live
- Stale time of 30 seconds so it stays responsive

### Frontend Integration: `src/components/market/SlateRefreshControls.tsx`

- Import and use `usePipelinePreflight`
- Before the existing "Refresh All Engines" flow, show a warning banner if `isHealthy === false`
- Display blockers as a red/amber alert row above the refresh button:
```
[!] 2 pipeline issues detected:
  - Odds data is stale (last update 6h ago)  
  - API budget exhausted (0 remaining)
[Fix Issues] [Refresh Anyway]
```
- The "Fix Issues" button links to the admin panel
- "Refresh Anyway" proceeds with a confirmation toast
- When healthy, show a small green checkmark: "Pipeline healthy"

### Telegram Alert Format (in `bot-send-telegram`)

- Add a new `preflight_alert` message type handler
- Format:
```
PIPELINE PREFLIGHT FAILED

2 blockers detected before generation:
- Odds data stale (0 props for today)
- API budget exhausted

Action required before next generation cycle.
```

---

## Technical Details

### New Files
1. `supabase/functions/bot-pipeline-preflight/index.ts` -- The preflight check function
2. `src/hooks/usePipelinePreflight.ts` -- Frontend hook to surface preflight status

### Modified Files
1. `supabase/functions/data-pipeline-orchestrator/index.ts` -- Add preflight call before Phase 3
2. `src/components/market/SlateRefreshControls.tsx` -- Show preflight status + blockers banner
3. `supabase/functions/bot-send-telegram/index.ts` -- Add `preflight_alert` message formatter

### No Database Changes Needed
- All checks query existing tables (`unified_props`, `nba_player_game_logs`, `api_budget_tracker`, `category_sweet_spots`, `game_bets`, `cron_job_history`, `bot_daily_parlays`)
- Results logged to existing `bot_activity_log` table
- No new tables or migrations required

