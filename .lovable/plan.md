
## What's broken

Today is **2026-04-26 ET**. The parlay pipeline has been **silently dead since 2026-04-22** — last `bot_daily_parlays` row is from 2026-04-21, last `category_sweet_spots` is 2026-04-21, and `bot_daily_pick_pool` for today has 0 rows. Meanwhile `unified_props` is healthy (585 fresh NBA props in last 6 hrs) and the cron jobs `refresh-l10-and-rebuild-pretip` and `-retry` report `succeeded` every day.

So the issue isn't infrastructure — cron fires, the orchestrator boots, the upstream feeds work. Something **inside the orchestrator** is bailing before it writes pool / parlays. I just manually invoked `refresh-l10-and-rebuild` and it's running cleanly through Phase 0 → Phase 1 right now (logs flowing). That means the function is healthy when triggered fresh; the scheduled runs were producing zero output silently.

## Plan

### Step 1 — Let the manual run complete and inspect every phase

The pipeline I just kicked off is mid-execution. I'll watch logs for `phase3c`, `phase3g`, `phase3i`, `phase3_lottery`, `phase3_odds_gate` (the phases the file header flags as historically buggy) and the final pool/parlay write counts. Whatever phase silently produces 0 rows IS the bug.

### Step 2 — Diagnose the root cause and fix it

Most likely culprits based on the file's own bug-history header and the dead-data pattern:

- **Stale `__oddsGateBlocked` global** (Bug 2 in the file header) — already fixed per the comments, but worth verifying the closure-scoped variable wasn't accidentally reverted.
- **Date drift** (Bug 1) — verify all `getEasternDate()` calls are still in place.
- **Phase 3c / Phase 3 lottery early-exit** when `nba_risk_engine_picks` is below `MIN_APPROVED_RISK_PICKS = 8`. Today has only **1** risk pick → matches the symptom exactly. The kill-switch `RISK_LAYER_BYPASSED = true` should bypass this gate; if a recent edit reintroduced the gate, generation would die here every day.
- A downstream invoke (`bot-quality-regen-loop`, `score-parlays-dna`, sweet-spots scorer) may be throwing an unhandled error that aborts the orchestrator before it persists pool rows.

### Step 3 — Backfill today's slate

Once the root cause is patched (or if the manual run already finishes successfully), confirm:
- `bot_daily_pick_pool` for `2026-04-26` has 100+ rows
- `bot_daily_parlays` for `2026-04-26` has 3–5 parlays
- `category_sweet_spots` for `2026-04-26` is populated

If the manual re-run completes but produces zero rows, force-call the downstream child functions in sequence (`build-pick-pool` → `bot-quality-regen-loop` → `score-parlays-dna`) to isolate which one is the silent-failure culprit, then patch that one.

### Step 4 — Add a guardrail so this never silently dies again

Add a single end-of-orchestrator assertion that, if `getParlayCount(today) === 0` after all phases run, sends a Telegram admin alert via the existing `sendPipelineAlert` helper (per `mem://infrastructure/pipeline/monitoring`). Right now success returns `succeeded` to cron even when zero parlays were produced — that's why this rotted for 4 days unnoticed.

## Technical details

**Files I'll likely edit in build mode:**
- `supabase/functions/refresh-l10-and-rebuild/index.ts` — patch the silent-failure phase + add the zero-output Telegram alert at the bottom of the orchestrator.
- Possibly `supabase/functions/build-pick-pool/index.ts` or whichever child function is identified as the failure point.

**Files I will NOT edit:**
- Cron schedules (they're firing correctly).
- `unified_props` ingestion (healthy).
- Parlay engine v2 selection / validation logic (per `mem://logic/parlay/same-game-concentration` the 0.75 cap stays as-is).
- `fanduel-boost-scanner` (the NBA-only scope-down from last turn stays).

**Investigation tools:**
- `edge_function_logs` on `refresh-l10-and-rebuild` to tail the in-flight run.
- `read_query` on `bot_daily_pick_pool`, `bot_daily_parlays`, `category_sweet_spots`, `nba_risk_engine_picks` for today after each phase.
- If needed: `curl_edge_functions` to invoke individual child functions and isolate the failure point.

## Outcome

- Today's parlays generate from real FanDuel lines (the 585 fresh NBA props already sitting in `unified_props`).
- Whatever silently broke 4 days ago is patched.
- The orchestrator alerts admin via Telegram if it ever produces 0 parlays again, so this can't rot for days unnoticed.
