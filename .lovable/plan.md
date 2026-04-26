
## What we're doing and why

You picked **"Both — scope down boosts AND revert generator"**. After investigating, here's the real picture:

**Good news:** The parlay generator code (`parlay-engine-v2`, `uploaded-pipeline-generator`) was **never wired to FanDuel boosts**. It still reads `unified_props` (your real-lines FanDuel pipeline). No code revert needed there.

**Bad news:** Today's `bot_daily_pick_pool` has only **3 picks** (vs 140–317 on normal days), and `bot_daily_parlays` has **zero rows for 2026-04-22**. The morning-prep pipeline that feeds the generator stopped producing — most likely a side effect of attention being on the boost scraper instead of the real-lines pipeline. So "revert" really means **diagnose and restart the real-lines pipeline so today's parlays generate again.**

## Plan

### Part 1 — Scope down the FanDuel boost scanner (5 min change)

In `supabase/functions/fanduel-boost-scanner/index.ts`:

- Cut `TARGET_URLS` from 8 URLs down to **2**: only `https://sportsbook.fanduel.com/boosts` and the mobile fallback `https://m.sportsbook.fanduel.com/boosts`. Drop all `/promos` URLs and the regional state subdomains (`nj.`, `pa.`, `co.`).
- Cut `maxAttempts` from 4 → **2** so we fail fast instead of burning ScrapingBee credits on a bot-detected page.
- Add a hard sport filter so only **NBA** boosts get persisted to `fanduel_boosts` (skip MLB/NFL/etc. — keeps the table clean while we evaluate whether boosts are worth pursuing at all).
- Result: ~85% fewer ScrapingBee credits per run. Boost scanner becomes a low-cost background experiment instead of the main event.

### Part 2 — Restore the real-lines parlay pipeline (the actual fix)

This is the one that matters. Steps:

1. **Diagnose why today's pool is empty.** Check edge function logs for the morning-prep orchestrator and the pool-build job to see whether they ran, errored, or silently produced zero picks.
2. **Re-run the pipeline manually for 2026-04-22** to backfill today's pool from current `unified_props` data. This uses your existing real-lines code path — no code change needed if logs show it just didn't fire.
3. **Verify fix** by checking that `bot_daily_pick_pool` for today has the normal 100+ picks and that `bot_daily_parlays` produces 3–5 parlays.
4. **If the orchestrator code itself is broken** (vs just not having been triggered), inspect recent edits to `morning-prep-pipeline` / `refresh-l10-and-rebuild` and revert any that touched line-fetching logic. Per your saved memory `mem://infrastructure/pipeline/morning-prep-pipeline-unified`, this orchestrator is the canonical entry point.

### Part 3 — Confirm nothing else regressed

Quick sanity checks while we're in there:
- `unified_props` has fresh FanDuel lines for today (the high-frequency 5-min sync is healthy).
- Per `mem://infrastructure/market-data/fanduel-integration`, the `has_real_line` mandate is still enforced.
- No code path in `parlay-engine-v2` has been accidentally pointed at `fanduel_boosts`.

## Technical details

**Files I'll edit in build mode:**
- `supabase/functions/fanduel-boost-scanner/index.ts` — trim `TARGET_URLS`, lower `maxAttempts`, add NBA sport filter before insert.

**Files I'll likely NOT edit (pending diagnosis):**
- `supabase/functions/parlay-engine-v2/index.ts` — appears intact, still reads `unified_props`.
- `supabase/functions/uploaded-pipeline-generator/index.ts` — same.

**Investigation tools I'll use after approval:**
- `supabase--edge_function_logs` on `morning-prep-pipeline`, `refresh-l10-and-rebuild`, and `parlay-engine-v2` to find the failure point.
- `supabase--read_query` to confirm `unified_props` freshness.
- `supabase--curl_edge_functions` to manually re-trigger the pipeline once cause is found.

**What I will NOT do:**
- Will not delete the boost scanner or its schema (keeps the option open).
- Will not change correlation gates, same-game caps, or any of the validation logic in `mem://logic/parlay/same-game-concentration` — those stay as-is.
- Will not touch `unified_props` ingestion.

## Outcome

After this:
- Boost scanner runs cheap and quiet (NBA only, 2 URLs, fail fast).
- Today's parlays get generated from real FanDuel lines.
- We're back on the working pre-boost-scanner trajectory with one small experiment running on the side.
