---
name: scout-speed-edge
description: Phase-0 lag-hunter that fires Telegram speed edges when live events front-run sportsbook lines
type: feature
---

Phase-0 heuristic engine in `supabase/functions/scout-live-edge` + `market-snapshot-ingest` + `edge-resolver`.

- Tables: `live_events`, `market_snapshot`, `lag_edges`, `market_baselines` (admin-read RLS).
- Defaults: `EV_FLOOR = 0.03`, edge window = 15s, snapshot lookback = 30s. Excess-lag floor = 2s above per-market baseline.
- Dedupe: unique `(source_event_id, edge_type)` — 23505 is silently skipped.
- Stake = ½-Kelly, floored at 0. EV = `prob*expectedMove - (1-prob)*1.0`.
- Heuristic in `_shared/scout-speed/scoring.ts` is **temporary**. Do NOT hand-tune coefficients. Replace with a logistic regression fit on `lag_edges.actual_move` once ≥2 weeks of resolved rows exist, then raise `EV_FLOOR`.
- Telegram delivered via existing `bot-send-telegram` with `admin_only: true` (reuses chunking/rate logic). Property labels are full English ("Assists", "Points") per core memory rule.
- Ingest HMAC: `X-Webhook-Signature: sha256=<hex>` verified against `LIVE_EVENT_WEBHOOK_SECRET` / `ODDS_FEED_WEBHOOK_SECRET`. Missing secret → skip (dev only).
- `{"ping": true}` short-circuit on `scout-live-edge` is unauthenticated (used by minute warm-keeper cron).
- Admin UI: `/admin/scout-speed` — active edges + last 30 fired, realtime sub on `lag_edges`.
- Cron: `scout-speed-edge-resolver` (every minute, expires + captures actual_move) and `scout-live-edge-warmer` (every minute, pings).
- 5 Deno tests in `_shared/scout-speed/scout-speed_test.ts` (relevance map, scoreEdge monotonicity, EV/Kelly floors, HMAC accept/reject, Telegram formatter).
- Out of scope Phase 0: full 3-column Scout Live page, Chess Alerts views, closing-line / outcome population, vision/OCR ingest, auto-hedge, live SGP builder.