## Scout Speed Edge Engine — Phase 0 Build Plan

Backend-only first pass. Real feeds POST to our webhooks. Telegram routes to admin chat. Defaults from spec (EV_FLOOR=0.03, 15s window, unique (source_event_id, edge_type) dedupe). UI = minimal admin Edge Terminal table for now.

### 1. Database migration

Single migration creating:
- `live_events` (sport, game_id, event_time, event_type, player_name, team, raw_data jsonb) + indexes on `(game_id, event_time desc)` and `(event_type, created_at desc)`.
- `market_snapshot` (sportsbook, game_id, market_type, player_name, line, odds, captured_at) + indexes for game/market/time lookups.
- `lag_edges` with detection signals, model outputs, lifecycle, backtest fields, FK to `live_events` and `market_snapshot`, partial index `(status, expires_at) where status='active'`, and unique `(source_event_id, edge_type)` for dedupe.
- `market_baselines` seeded with the 7 default lag rows.
- RLS: all four tables service-role-only writes; `lag_edges` readable by admins via existing `has_role(auth.uid(),'admin')` for the Edge Terminal UI.
- ET-standardized timestamps (`timestamptz default now()`), matching core memory rules.

### 2. Edge functions

Three new functions, all `verify_jwt = false`, HMAC verification on the two ingest endpoints.

**`market-snapshot-ingest`** — Accepts single object or `{snapshots:[...]}`, validates with Zod, bulk-inserts into `market_snapshot`. Verifies `ODDS_FEED_WEBHOOK_SECRET` HMAC header.

**`scout-live-edge`** — Event webhook. Flow:
1. `{ping:true}` short-circuit for warm-keeper.
2. Verify `LIVE_EVENT_WEBHOOK_SECRET`.
3. Insert into `live_events`.
4. Load `market_baselines` into a Map.
5. Pull last 30s of `market_snapshot` for the game.
6. For each snapshot: relevance map gate → player-name filter for `player_*` markets → compute `lag = event_time - captured_at` → require `excess_lag ≥ 2s` → score via heuristic `scoreEdge()` + `impactScore()` → require `EV ≥ 0.03` → compute half-Kelly stake → insert `lag_edges` row with `expires_at = now()+15s` → on success (23505 = silent skip) fire Telegram → stamp `fired_at`.
7. Telegram message uses spec format with FIRE/STRONG/WATCH tiers and full property labels ("Assists", "Points", etc.) per core memory rule, sent through existing `bot-send-telegram` with `admin_only: true` so we reuse chunking/rate logic instead of calling Telegram API directly.

**`edge-resolver`** — Minute-cron. Selects active edges past `expires_at`, joins latest snapshot vs origin snapshot to compute `actual_move`, marks `status='expired'`. Scheduled via `pg_cron` + `pg_net` (separate `supabase--insert` call, not migration, so it isn't replayed on remixes).

A warm-keeper cron also pings `scout-live-edge` every 60s.

### 3. Shared utilities

`supabase/functions/_shared/scout-speed/` with:
- `relevance.ts` — event↔market type map.
- `scoring.ts` — `impactScore`, `scoreEdge` (heuristic, clearly marked PHASE-0), `halfKellyStake`, EV calc.
- `hmac.ts` — shared HMAC verifier for both ingest endpoints.
- `telegram-format.ts` — alert formatter with tier emoji + full property labels.

Five Deno tests per memory rule (`constraints/testing-policy`): relevance map, scoreEdge monotonicity in excess_lag, EV floor gate, half-Kelly non-negativity, dedupe (23505) skip behavior.

### 4. Minimal admin UI

New route `/admin/scout-speed` (gated by `useAdminRole`):
- Polls `lag_edges` (status=active, ordered by `model_edge desc`) every 5s + realtime subscription on insert/update.
- Table columns: Player • Market+Line • Book • Confidence% • EV% • Lag (s) • Countdown • Status.
- Color band: red ≥10% EV, orange 6–10%, gray 3–6%.
- Bottom strip: last 30 fired edges with W/L/expired/void chip.
- Link added under existing admin nav. No Live Field, no Chess Alerts in this pass (deferred to Phase 1 UI).

### 5. Secrets & config

Request via `add_secret` if not already present:
- `ODDS_FEED_WEBHOOK_SECRET`
- `LIVE_EVENT_WEBHOOK_SECRET`

`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` already configured (used by other bot functions).

### 6. Memory

Add `mem://features/scout/speed-edge` describing: Phase-0 heuristic in place, EV_FLOOR=0.03, 15s window, dedupe rule, calibration plan (export → logistic regression → hardcode coefficients → raise floor). Add a Core line: *"Scout Speed Edge is Phase-0 heuristic until lag_edges has ≥2 weeks of actual_move data — do not tune by hand."*

### Out of scope this pass

Full 3-column Scout Live page, Chess Alerts views, closing-line resolver, vision/OCR ingest, auto-hedge, live SGP builder. All called out in spec Phase 2 and will be separate plans.

### Sequence

1. Migration (await approval).
2. Shared utils + 3 edge functions + tests.
3. Deploy + curl smoke tests via `supabase--curl_edge_functions` (ping, snapshot insert, synthetic event → expect lag_edge row + Telegram).
4. Cron schedule via `supabase--insert`.
5. Admin UI page + nav link.
6. Memory write.
