# AI Models Intelligence — Elo, Poisson, XGBoost into Telegram

Build three new modeling layers on top of the existing pipeline and route their daily output to a dedicated Telegram channel/section called **AI Models Intelligence**, isolated from the Gold / Sweet Spot / Hedge streams so its ROI is tracked independently.

All models train from data already in the DB (`settlement_records`, `prop_results_archive`, `*_player_game_logs`, `nuke_historical_games`). No external backfill.

---

## What gets built

### 1. Rolling Elo (team strength)
- One Elo per team per sport (NBA, MLB, NHL).
- Updated daily from `nuke_historical_games` (settled) and `settlement_records` (team-market settlements).
- Standard Elo update with home-court K=20, MOV multiplier, regression to mean each off-season.
- Exposed as a probability for H2H (moneyline) and as an edge vs. closing line for spread.

### 2. Poisson / Dixon-Coles (game totals)
- MLB runs + NHL goals modeled with team attack/defense rates from `nuke_historical_games` scores.
- Dixon-Coles low-score correction for NHL.
- Outputs expected total + probability of Over/Under at the posted total.

### 3. XGBoost-style prop hit-rate (gradient-boosted trees, pure Deno)
- Trains on `prop_results_archive` (19k rows) joined with `*_player_game_logs` for features (L3/L5/L10 averages, opponent defensive rank, minutes/lineup, rest days, home/away).
- Pure-Deno gradient boosting (small JS implementation, no Python worker required for v1). Re-trained nightly per sport+prop_type.
- Outputs calibrated hit probability per active prop in `unified_props`.

### 4. Daily Telegram digest — "AI Models Intelligence"
- New scheduled function posts one consolidated message per day to a dedicated chat (Destiny_0711 admin + opt-in subscribers).
- Sections: top 5 Elo edges, top 3 Poisson totals edges, top 5 XGBoost prop edges.
- Full property names ("Points", not "Pts") per existing Telegram conventions.
- Isolated ROI: results stored under `model_intel_*` so it never blends into Gold/Sweet Spot accuracy.

---

## Pipeline integration

```text
06:00 ET  model-train-nightly       → rebuild Elo + Poisson + XGBoost artifacts
07:00 ET  model-predict-daily       → score today's slate, write model_predictions
09:30 ET  model-intel-broadcast     → post AI Models Intelligence digest to Telegram
11:00 ET+ parlay-engine-v2          → reads model_predictions as a *non-fatal* confidence layer
post-game model-settle-nightly      → score yesterday's picks → model_intel_results
```

Models are additive. If a model run fails it is logged as non-fatal — existing engines keep running.

---

## Telegram delivery contract

- New row in `telegram_subscribers_settings` / equivalent override table for the "AI Models Intelligence" channel.
- Message format mirrors existing rich-emoji alert style.
- One daily message at 09:30 ET, optional second message 30 min before first MLB / NBA / NHL game with model edges that opened ≥3%.
- No leakage into Gold/Sweet Spot/Final-Verdict pipelines for v1.

---

## Technical section

### New tables (schema migrations)
- `model_team_elo` — `sport, team, rating, games_played, last_updated_at` (one row per team per sport).
- `model_totals_params` — `sport, team, attack, defense, home_adv, updated_at` (Poisson rates).
- `model_prop_artifacts` — `sport, prop_type, model_blob jsonb, feature_spec jsonb, trained_at, sample_size, calibration jsonb`.
- `model_predictions` — `id, sport, game_date_et, event_id, model, market_type, side, line, prob, edge_pct, created_at` (cleared daily).
- `model_intel_results` — settlement of yesterday's model picks for isolated ROI.
- `model_intel_telegram_log` — broadcast audit, idempotent by `(date_et, channel)`.

All schemas use `current_line`, `game_description`, ET dates per core rules. `has_real_line` is checked before any prediction is published.

### New edge functions
- `model-elo-rebuild` — recompute Elo from `nuke_historical_games` + `settlement_records` team outcomes.
- `model-poisson-fit` — fit attack/defense per team per sport.
- `model-xgb-train` — train per `(sport, prop_type)` from `prop_results_archive` + player game logs (pure-Deno GBT).
- `model-predict-daily` — score today's slate using artifacts.
- `model-intel-broadcast` — render and send the daily Telegram digest via the connector gateway.
- `model-intel-settle` — settle yesterday's model picks into `model_intel_results`.

### Cron schedule (pg_cron, inserted via insert tool not migrations)
- 06:00 ET train, 07:00 ET predict, 09:30 ET broadcast, 02:00 ET settle.

### Safeguards
- Snapback / Live Drift remain blacklisted — XGBoost features never include them.
- Tennis is excluded from v1 (existing tennis-data-sync still handles it).
- Each new function wraps Supabase `.then()` in try/catch and ET-normalizes dates.
- 5 independent verification tests per testing-policy rule before the broadcast cron is enabled (manual `model-predict-daily` run, settlement parity check, Elo monotonicity, Poisson reasonableness sanity, Telegram dry-run render).
- Same-game concentration cap (0.75 temp, min 2 distinct games) is enforced if model edges ever feed parlays in a later phase.

### Out of scope for this plan
- Wiring model output into Gold / Final Verdict / Sweet Spot generation (silent boosts) — separate follow-up.
- Python LightGBM worker — not needed for v1; the pure-Deno GBT is sufficient at current data sizes.
- Backfilling pre-2024 historical results.
