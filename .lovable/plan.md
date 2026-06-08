## Goal
Get **every minute of MLB Fair-Price latency activity** delivered to the admin Telegram, plus an **immediate alert when the book-snapshot feed goes dark**, and provide a one-click way to verify it's working.

Right now: the `mlb-fair-price-digest` edge function exists and sends an admin Telegram, but it is **never scheduled**. The live engine only sends a Telegram on `gate_decision = "fire"`, and the last 24h had 0 fires (all 27 evals were `no_book_or_suspended` skips). That's why nothing arrives.

## Changes

### 1. Upgrade `mlb-fair-price-digest` to a minute-level latency pulse
Currently it sends a 24h + 7d summary — way too coarse for live monitoring. Rework it to support two modes via `?mode=pulse|daily` (default `pulse`):

- **`pulse` (default, 1-min cron):** Aggregates the **last 5 minutes** of `mlb_fair_price_events`:
  - eval count, fire count, sent count
  - skip breakdown (top 3 reasons)
  - latency: p50 / p90 of `feed_ts − book_last_move_ts` for fires
  - `lag_edges` count in window + p90 excess_lag_seconds
  - book-snapshot health: if `book_snapshot` table has 0 rows inserted in last 5 min OR ≥90% of skips are `no_book_or_suspended`, prepend a 🚨 `BOOK FEED DOWN` banner
  - **Quiet rule:** if there were 0 evals AND 0 lag_edges in the window, skip sending (don't spam during off-hours). Always send when the outage banner triggers.
- **`daily`:** Existing 24h + 7d digest (unchanged behavior), keep for once-a-day rollup.

All sends go through `buildFairPriceAdminPayload` → `bot-send-telegram` with `admin_only: true` (already the existing admin route).

### 2. Schedule the pulse via `pg_cron`
Insert (not migration — contains the project URL + anon key):
- `mlb-fair-price-pulse` — every minute, calls digest with `?mode=pulse`
- `mlb-fair-price-daily` — once daily at 9:05am ET (13:05 UTC), calls digest with `?mode=daily`

### 3. Immediate book-snapshot outage alert (debounced)
Inside the `pulse` handler, when the outage condition is detected, write a row to a tiny new table `admin_alert_state` keyed by `alert_key` to debounce — only re-send the outage alert if last sent >15 min ago OR state flipped from healthy→down. Same table tracks recovery (down→healthy) so admin gets a "✅ Book feed recovered" ping.

### 4. Manual "Send test ping" button on `/admin/mlb-fair-price`
Add a small admin-only button in the header that calls `mlb-fair-price-digest?mode=pulse&force=1` (force bypasses the quiet rule) and toasts the Telegram API response, so you can verify end-to-end in one click without waiting for cron.

## Verification
1. Click the new "Send Test Ping" button on `/admin/mlb-fair-price` → admin Telegram receives a pulse message within 5 sec; toast shows `ok: true`.
2. Manually `curl` the digest endpoint with `?mode=pulse&force=1` → identical Telegram message arrives.
3. Wait 2 minutes, check `edge_function_logs` for `mlb-fair-price-digest` → confirm cron-fired invocations at minute boundaries.
4. While book-snapshot is empty (current state), pulse messages include the 🚨 `BOOK FEED DOWN` banner naming the dominant skip reason.
5. Insert a fake `book_snapshot` row → within the next 1-min tick, recovery alert "✅ Book feed recovered" is delivered exactly once.

## Technical details
- New table `admin_alert_state(alert_key text primary key, status text, last_sent_at timestamptz, payload jsonb)` with service-role-only access (admin debouncer; no client read).
- `pulse` window = last 5 min so we never miss activity even with 1-min cron jitter; dedupe is handled by `admin_alert_state` and the quiet rule (no row inserted for empty pulses).
- All ET timestamps via existing `etDateShort` / `date-et.ts` helper.
- No changes to `scout-live-edge` evaluation logic — only the reporting layer changes.
- No customer-facing surface affected; everything routes through `admin_only: true`.
