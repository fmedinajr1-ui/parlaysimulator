## Goal
Run the NBA Sharp Money playbook (price-edge + line-movement detection → engine_live_tracker → automated settlement) across every in-season sport: MLB, WNBA, tennis, soccer. No fake/scaffold data — everything must trace to a real bookmaker line and a real final stat line.

## Current gap (verified)
- `engine_live_tracker` last 7d: only `Unified Props` is writing. `Bot Exploration`, `Sweet Spot`, `Juiced` have been dark since March.
- `unified_props` active rows: MLB/WNBA = h2h/spreads/totals only (no player props). Tennis = 0. Soccer = futures only.
- `sharp_line_tracker` has 42 rows in 7d — all manual NBA entries. Zero automated tracking for MLB/WNBA/tennis/soccer.
- `mlb_engine_picks` table exists with 1.4k historical rows but the writer (mlb-pitcher-k-analyzer / mlb-rbi-under-analyzer) hasn't fired since March.
- `tennis_match_model`, `soccer_match_results`, `soccer_player_match_stats` tables exist but are empty.

## Plan

### 1. Automated Sharp Money tracker (4 sports)
New edge function `sharp-tracker-auto-ingest` runs every 10 min via pg_cron:
- Pulls active player-prop and totals rows from `unified_props` for `baseball_mlb`, `basketball_wnba`, `tennis_atp`, `tennis_wta`, `soccer_*` leagues.
- For each `(player, prop_type, line)`, if no existing `sharp_line_tracker` row, INSERTs as the opening snapshot. If it exists, UPDATEs `current_line` / `current_over_price` / `current_under_price`.
- Computes `ai_direction` using the same vig-free price-edge math as the side-picker, gated by `SPORT_EDGE_FLOOR`. Tags `ai_signals.sharp` when line moves ≥ 0.5 against price (steam) or price moves ≥ 15c with line static.
- Writes a mirror row into `engine_live_tracker` with `engine_name='Sharp Money'`, `status='pending'` so the existing settlement loop grades it the same way NBA picks are graded.

### 2. Reactivate Bot Exploration for MLB + WNBA
- Audit `mlb-pitcher-k-analyzer`, `mlb-rbi-under-analyzer`, `mlb-no-hr-team-analyzer` — they already write to `mlb_engine_picks`. Remove the sport-gate / cron-disable that stopped them in March (likely a `is_in_season` flag).
- Add a thin bridge `mlb-engine-bridge` that mirrors new `mlb_engine_picks` rows into `engine_live_tracker` with `engine_name='Bot Exploration'` so they show up in the same accuracy dashboard.
- WNBA: extend `wnba-backtest-signals` to also write live picks (currently backtest-only) into `engine_live_tracker` for active games.

### 3. Tennis pipeline (real data)
- Tennis odds: `tennis-props-sync` already fetches from The Odds API. Confirm it's populating `unified_props` for `tennis_atp`/`tennis_wta`; if not, enable the cron and add ATP/WTA to the sport-allowlist.
- Tennis settlement: extend `court-edge-settle` pattern — scrape TennisAbstract for final game totals — to also grade `engine_live_tracker` rows where `sport ILIKE 'tennis%'`. Add a new `tennis-engine-settler` that re-uses `playerSlug` + `parseRecentRows` from `_shared/court-edge-slug.ts`.

### 4. Soccer pipeline (real data)
- Soccer odds ingest: add `soccer-odds-ingest` (The Odds API) for EPL/MLS/UCL/La Liga player props (goals, shots, shots on target, cards) → `unified_props`.
- Soccer stats ingest: add `soccer-stats-ingest` that pulls final box scores from a free source (api-football free tier or football-data.org) → populates `soccer_match_results` + `soccer_player_match_stats`.
- `soccer-engine-settler` already exists as scaffold — it'll start grading the second real stats land.

### 5. Cron + orchestration
Add pg_cron jobs:
- `sharp-tracker-auto-ingest` — every 10 min
- `mlb-engine-bridge` — every 15 min during MLB window (12pm–11pm ET)
- `tennis-engine-settler` — every hour
- `soccer-odds-ingest` — every 30 min
- `soccer-stats-ingest` — every 2 hours
- `soccer-engine-settler` — every hour after stats ingest

### 6. Verification (must pass before claiming done)
For each of the 4 sports, prove:
1. `unified_props` has > 0 active player-prop rows updated in the last hour.
2. `engine_live_tracker` has new `pending` rows from at least one engine in the last hour.
3. Settled rows from yesterday have non-null `result` and a real `actual_value`.
4. Win rate is computed from ≥ 5 real settled picks per sport.

## Technical details

### Files to create
- `supabase/functions/sharp-tracker-auto-ingest/index.ts`
- `supabase/functions/mlb-engine-bridge/index.ts`
- `supabase/functions/tennis-engine-settler/index.ts`
- `supabase/functions/soccer-odds-ingest/index.ts`
- `supabase/functions/soccer-stats-ingest/index.ts`
- `mem/logic/betting/multisport-sharp-money.md`
- Migration: pg_cron schedules + any needed index on `sharp_line_tracker (sport, player_name, prop_type, line)`.

### Files to edit
- `supabase/functions/mlb-pitcher-k-analyzer/index.ts` — remove March-era sport-gate
- `supabase/functions/mlb-rbi-under-analyzer/index.ts` — same
- `supabase/functions/wnba-backtest-signals/index.ts` — add live-mode flag
- `supabase/functions/tennis-props-sync/index.ts` — confirm sport allowlist
- `supabase/functions/soccer-engine-settler/index.ts` — already works once stats land
- `mem/index.md` — register new memory file

### Secrets required
- `THE_ODDS_API_KEY` — likely already present (used by existing odds sync)
- `FOOTBALL_DATA_API_KEY` or `API_FOOTBALL_KEY` — for soccer box scores. I'll ask you for one before adding the soccer stats ingest; until then soccer settles via web-scrape fallback.

### Scope of this turn
I'll ship sections 1, 2, 3, and 5 (everything except soccer stats ingest which needs a key) — then verify each sport produces real picks and real settlements. Soccer will stay on the existing scaffold pending the API key.

## Out of scope
- New UI surfaces (existing accuracy dashboards already read from `engine_live_tracker`).
- Re-grading historical March picks (those were already settled in `mlb_engine_picks`).
- NHL / NCAAB / NFL / NBA (all offseason).
