## Goal
Grade every pending `fade_parlay_of_the_day` (10) and `optimal_combo` (49) parlay, then deliver a per-leg hit/miss report.

## What exists today
- `cross-sport-parlay-settler` already has all the leg-grading machinery: player-prop lookups against per-sport `*_player_game_logs`, team/h2h lookups against `live_game_scores`, DNP-void handling, and parlay outcome rollup.
- It only iterates parlays where `strategy_name LIKE 'cross_sport_%'` (etc.) inside `bot_daily_parlays`. It never touches `ai_generated_parlays`.

## Build

### 1. Extend `cross-sport-parlay-settler`
- Add a second query loop for `bot_daily_parlays` with `strategy_name = 'optimal_combo'` (same table, same leg shape — moneyline/team legs use the existing `live_game_scores` path; reusing existing code).
- Add a third loop over `ai_generated_parlays` where `strategy_used = 'fade_parlay_of_the_day'` and `outcome = 'pending'`. Map columns: `legs` (jsonb), `leg_count` derived from `jsonb_array_length`, `parlay_date` from `created_at::date AT TIME ZONE 'America/New_York'`. Reuse the same `gradeLeg()` function. Write back to `outcome`, `settled_at`, plus a new `legs_graded` jsonb array holding per-leg `{hit, actual, line, side, reason}` so we can render the report.
- For fade legs the leg's stored `side` is already the recommended fade side — grade it as-is (per the core memory: `prediction` is the recommended play side; never invert).
- Skip h2h legs that lack `event_id` resolvable in `live_game_scores` — mark `ungradable_missing_context` (void). Historical NCAAF/MMA legs without score data will void cleanly.

### 2. Migration: add `legs_graded jsonb` to both parlay tables
- `ai_generated_parlays.legs_graded jsonb`
- `bot_daily_parlays.legs_graded jsonb` (already has `legs_hit`/`legs_missed` counts but no per-leg detail)

### 3. Run settler + export report
- Invoke the updated settler.
- Query both tables for any parlay with `legs_graded IS NOT NULL`, build a Markdown report (`/mnt/documents/parlay_leg_report.md`) grouped by parlay → leg with ✅/❌/⚪ per leg, plus a summary table of overall hit rate per strategy.

## Out of scope
- No changes to generators, no Telegram broadcast of the report (artifact only).
- Future automation (cron) is unchanged; existing cron for the settler will now also catch these strategies automatically.

## Risks
- Most fade-parlay legs are MMA/NCAAF h2h or MLB totals — `live_game_scores` coverage for older MMA cards may be thin, so many will land as `void` rather than win/loss. That is the honest answer to "what's the accuracy" — we'll surface it as void counts in the report.
