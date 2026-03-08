

## Pre-Game Leg Verification & Auto-Swap Pipeline

### Problem
Currently, parlays are generated and broadcast without a final pre-game check. If a player gets injured or a leg becomes void-worthy (lineup scratch, game postponement) between generation and tip-off, the parlay goes out with a dead leg. The user wants the bot to automatically detect these issues and swap in a substitute pick.

### Existing Infrastructure to Leverage
- **`lineup-cross-reference`** — already checks player injury status (OUT/GTD) and returns risk levels + recommendations (AVOID/WAIT/PROCEED)
- **`firecrawl-lineup-scraper`** — fetches latest injury/lineup data from ESPN APIs
- **`find-swap-alternatives`** — already finds replacement picks from unified_props, median_lock_candidates, juiced_props, and hit rate data
- **`bot-pipeline-preflight`** — existing preflight checks (odds freshness, game logs, etc.)
- **`broadcast-new-strategies`** — sends parlays to Telegram

### Plan: New Edge Function `pre-game-leg-verifier`

**Single new edge function** that runs ~1-2 hours before game time and does three things:

1. **Fetch all pending parlays** for today from `bot_daily_parlays` where `status = 'pending'`

2. **For each parlay, check every leg** against:
   - Fresh injury data via `firecrawl-lineup-scraper` (or directly query the injury tables)
   - Player status: if OUT → flag for swap; if GTD → flag as warning
   - Game status: postponed/cancelled → flag for void

3. **Auto-swap flagged legs:**
   - Call `find-swap-alternatives` for each flagged leg
   - Pick the top alternative (highest confidence, `strong_upgrade` or `upgrade` recommendation)
   - Update the parlay's `legs` JSON in `bot_daily_parlays` with the swap (preserving original leg in metadata for audit)
   - If no suitable swap found → void the parlay entirely and mark it

4. **Broadcast a summary** to Telegram via `bot-send-telegram`:
   - Which parlays had swaps
   - Original leg → new leg details
   - Any parlays voided due to no viable swap

### Scheduling
- Add a cron job at **12:00 PM ET** (before most NBA/NHL games) to run this automatically
- Also callable manually from the admin panel or Telegram `/verify_legs` command

### Database Changes
- Add a `legs_swapped` integer column to `bot_daily_parlays` (via migration) to track swap count
- Store swap audit trail in the parlay's existing `metadata` JSON field

### Files to Create/Edit
1. **Create** `supabase/functions/pre-game-leg-verifier/index.ts` — the main pipeline
2. **Edit** `supabase/functions/bot-send-telegram/index.ts` — add `leg_swap_report` message type
3. **Migration** — add `legs_swapped` column to `bot_daily_parlays`
4. **Cron job** — schedule at 17:00 UTC (12 PM ET)

