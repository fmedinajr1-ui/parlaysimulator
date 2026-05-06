# Nuke Scout — Historical Backtest (60–90 days)

Goal: prove the script-scoring + parlay-builder system has real edge **before** flipping on live auto-post. Pull historical games + closing prop lines, replay them through the exact same `scoreGame()` and `buildParlays()` code that runs live, grade against actual results, and report hit rate / ROI / drawdown by tier and template.

## What we'll build

1. **Historical odds ingest** — `nuke-backtest-ingest` edge function
   - Pulls from The Odds API `/historical/sports/{sport}/events` and `/historical/sports/{sport}/events/{id}/odds` for NBA, MLB, soccer (EPL/UCL/MLS), tennis (ATP/WTA)
   - Window: last 90 days, configurable via `{ days_back, sports }`
   - Snapshot timestamp = **closing line** (1 hour before tip-off) — that's the line we'd realistically have bet
   - Stores raw events into a new `nuke_historical_games` table (game spread/ML/total) and prop lines into `nuke_historical_props` (player, market, line, price, book = FanDuel)
   - Throttled (Odds API historical = 10 credits/request) — function reports credits burned per run

2. **Historical results ingest**
   - Game finals from existing `game_results` table where available; gap-fill via Odds API `/scores` historical and ESPN scoreboard for the dates we don't have
   - Player prop results: hit existing `prop_results` first, then ESPN box-score fallback for missing rows
   - Stored on the same `nuke_historical_games` / `nuke_historical_props` rows (`actual_*` columns + `result` enum: `over | under | push | dnp`)

3. **Replay runner** — `nuke-backtest-replay` edge function
   - Iterates each historical date in the window
   - Calls the **live** `scoreGame()` from `_shared/parlayBuilder.ts` (no fork — we're testing the actual production logic) → STRONG / MEDIUM / SKIP
   - For STRONG-tier games, calls the live `buildParlays()` with that day's historical props
   - Grades each generated parlay leg-by-leg → parlay outcome (`won | lost | push | dnp`)
   - Persists every replayed parlay into a new `nuke_backtest_parlays` table with: date, sport, game, tier, template, legs (jsonb), combined_odds, in_window flag, outcome, profit_units

4. **Report generator** — same edge function, `mode: "report"`
   - Aggregates `nuke_backtest_parlays`:
     - Hit rate, ROI, sample size **by tier** (STRONG / MEDIUM)
     - Same breakdown **by template** (`role_player_over_carnage`, `mixed_chaos`, etc.)
     - Same breakdown **by sport**
     - Max drawdown (running P/L) — flag any 10+ parlay losing streak
     - In-window rate (% of parlays that landed inside +1000…+3000)
   - Returns JSON + writes a row to `nuke_backtest_runs` (run_name, window, summary jsonb)

5. **Decision gates wired into the existing dry-run flag**
   - `nuke-build-parlays` already reads `dryRun`. Add a hard guard: if no `nuke_backtest_runs` row exists for the active sport showing **≥100 STRONG parlays and ROI ≥ -10%**, the live path refuses to post and logs `blocked: insufficient_backtest_evidence`. Override only via explicit `force_live: true` in the cron payload.

## How we'll run it

1. Deploy the two new functions + migrations
2. Curl `nuke-backtest-ingest` with `{ days_back: 90, sports: ["nba","mlb","soccer_epl","tennis_atp"] }` — expect ~30–60 min runtime, will report credit usage. **Stop and confirm with you before burning all 90 days of credits if cost looks high.**
3. Curl `nuke-backtest-replay` with `{ mode: "replay", date_start, date_end }`
4. Curl same function with `{ mode: "report" }` — get the verdict per sport/tier
5. Share the report. Decision tree:
   - **ROI ≥ +0%** at 100+ STRONG parlays per sport → cleared for live
   - **ROI -10% to 0%** → break-even / small edge, ship at half stake and keep monitoring
   - **ROI < -10%** → strategy is broken, do not go live; iterate on `scoreGame` or template logic before re-running

## Technical details

- New tables (migration):
  - `nuke_historical_games(id, sport, game_date, home, away, spread, ml_home, ml_away, total, closing_snapshot_ts, actual_home_score, actual_away_score, settled)`
  - `nuke_historical_props(id, game_id fk, player, prop_type, line, price, side, snapshot_ts, actual_value, result)`
  - `nuke_backtest_parlays(id, run_id fk, parlay_date, sport, game_ref, tier, template, legs jsonb, combined_odds, in_window bool, outcome, profit_units)`
  - `nuke_backtest_runs(id, run_name, window_start, window_end, sports text[], summary jsonb, created_at)`
  - All RLS: service-role write, admin-read only (these are internal eval tables)
- Reuse `RosterClient` + `fetchEspnInjuries` from `_shared/rosters.ts` for historical roster lookups (ESPN history goes back ~3 yrs, fine for 90 days)
- Replay uses the **same** `_shared/parlayBuilder.ts` — zero duplication. If we tweak scoring later, re-running the backtest is one curl
- Odds API historical caveats: only FanDuel + DraftKings have full prop history; we'll pin to FanDuel to match our live source. Some early-MLB-season props will be missing — those games get `result: dnp` and excluded from ROI math
- Tennis prop coverage on Odds API historical is thin → expect smaller sample, may need to fall back to game-line-only parlays for tennis

## Out of scope (for this phase)

- Live posting toggle UI — already gated by `dryRun` + the new `force_live` flag
- Backfilling pre-2026 data — 90 days is the agreed window
- Auto-reruns — first pass is manual curls; we'll cron a weekly re-backtest only after the first run looks healthy
