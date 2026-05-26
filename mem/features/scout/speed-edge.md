---
name: scout-speed-edge
description: Phase-0 lag-hunter that fires Telegram speed edges when live events front-run sportsbook lines
type: feature
---

Phase-0 heuristic engine in `supabase/functions/scout-live-edge` + `market-snapshot-ingest` + `edge-resolver`.
Phase-1 learning loop adds `scout_speed_models` table + `scout-speed-model-trainer` function. Engine loads active model per request via `loadActiveModel` and passes coefficients to `scoreEdge`; falls back to heuristic when no active row exists.
Phase-2 auto-hedge: `scout-speed-hedge-monitor` (cron 1m) scans `lag_edges` fired in last 20m where `hedge_fired_at IS NULL`, compares latest `market_snapshot` line vs fired snapshot line, fires hedge Telegram + stamps `hedge_*` columns when reverse ≥ per-market `REVERSE_THRESHOLDS[edge_type]` (default 0.5) against `intended_direction`. Direction set on fire via `eventDirection(event_type, market_type)` — UNIVERSAL_DOWN: INJURY/FOUL/SUBSTITUTION/TIMEOUT/PITCHER_PULLED. Per-event override DOWN_OVERRIDES handles MLB cross-direction cases (STRIKEOUT→player_hits=down, WALK→player_strikeouts=down). Idempotent via `.is("hedge_fired_at", null)` guard on update.

Phase-2 MLB expansion: relevance map + impactScore + telegram labels extended to MLB events (STRIKEOUT, WALK, HIT, HOME_RUN, RBI, RUN_SCORED, STOLEN_BASE, PITCHER_PULLED) and player markets (player_strikeouts/hits/home_runs/total_bases/rbi/runs/stolen_bases/walks). Same engine path; ingester just POSTs `sport: "MLB"` events to `scout-live-edge`. Per-market `REVERSE_THRESHOLDS` table in hedge-monitor for future per-market tuning.

- Tables: `live_events`, `market_snapshot`, `lag_edges`, `market_baselines` (admin-read RLS).
- Defaults: `EV_FLOOR = 0.03`, edge window = 15s, snapshot lookback = 30s. Excess-lag floor = 2s above per-market baseline.
- Dedupe: unique `(source_event_id, edge_type)` — 23505 is silently skipped.
- Stake = ½-Kelly, floored at 0. EV = `prob*expectedMove - (1-prob)*1.0`.
- Heuristic in `_shared/scout-speed/scoring.ts` is the cold-start fallback only. Do NOT hand-tune coefficients. Trainer fits logistic (hit prob with `|actual_move| ≥ 0.25`) + closed-form OLS (move magnitude) on resolved `lag_edges`; requires `MIN_SAMPLES=200`. New models insert as `active=false` and must be promoted explicitly (`{activate_latest:true}` or `{activate:<version>}`). Raise `EV_FLOOR` from 0.03 → 0.05+ only after a model has shipped with credible log-loss across ≥2 weeks of resolved rows.
- Admin UI: `/admin/scout-speed` has a "Learned model" panel with **Train now** and **Activate latest** buttons plus log-loss/Brier/MSE per version. Model loader caches active row for 60s (`resetModelCache()` for tests).
- 10 Deno tests now cover Phase 0 + Phase 1 (heuristic fallback, model clamp to cap/floor, logistic boundary recovery, OLS coefficient recovery, EV/Kelly invariance).
- Telegram delivered via existing `bot-send-telegram` with `admin_only: true` (reuses chunking/rate logic). Property labels are full English ("Assists", "Points") per core memory rule.
- Ingest HMAC: `X-Webhook-Signature: sha256=<hex>` verified against `LIVE_EVENT_WEBHOOK_SECRET` / `ODDS_FEED_WEBHOOK_SECRET`. Missing secret → skip (dev only).
- `{"ping": true}` short-circuit on `scout-live-edge` is unauthenticated (used by minute warm-keeper cron).
- Admin UI: `/admin/scout-speed` — active edges + last 30 fired, realtime sub on `lag_edges`.
- Cron: `scout-speed-edge-resolver` (every minute, expires + captures actual_move), `scout-live-edge-warmer` (every minute, pings), and `scout-speed-closing-line-resolver` (every 15 min — backfills `closing_line` once a game's market is quiet ≥90 min and `fired_at` is ≥4h old; also fills `actual_move` if still null; flips active→expired).
- 5 Deno tests in `_shared/scout-speed/scout-speed_test.ts` (relevance map, scoreEdge monotonicity, EV/Kelly floors, HMAC accept/reject, Telegram formatter).
- Out of scope Phase 0: full 3-column Scout Live page, Chess Alerts views, closing-line / outcome population, vision/OCR ingest, auto-hedge, live SGP builder.