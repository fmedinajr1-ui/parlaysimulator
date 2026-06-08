# MLB Fair-Price Dashboard — Real Lines, Trigger Context, Latency Evidence

Three additions to `/admin/mlb-fair-price`. No engine, schema, or cron changes — read-only UI over data already being written by `scout-live-edge` + `mlb-fair-price-closing-resolver`.

## 1. "Real Lines" provenance badge + column

On every fire row in the Events Feed and the Game Detail Drawer:

- Show `book_id` (e.g. `fanduel`, `draftkings`), `book_price` (American), `opposite_book_price`, and `book_implied_devig` (de-vigged %) inline.
- Compute snapshot age = `feed_ts − book_last_move_ts` and render `Book snapshot: 1.4s before event ✓ live`.
- Add a green "REAL" pill when `book_id` is non-null and `book_price` is finite; gray "NO BOOK" pill when `skip_reason='no_book_or_suspended'`.
- Rollup tile at top: **% of fires backed by a real book snapshot (last 24h)** sourced from `mlb_fair_price_events` where `gate_decision='fire' AND book_id IS NOT NULL`.

This makes it visually obvious every fire is tied to a real `market_snapshot` row, not synthetic.

## 2. Trigger context (player + team + event)

Join each `mlb_fair_price_events` row to its `live_events` row by `(game_id, event_time, event_type)` (or by storing `live_event_id` if a cheap migration is acceptable later — out of scope for now, do the join client-side via game_id + feed_ts proximity).

New columns in the feed and drawer:
- Trigger: `HR` / `K` / `BB`
- Player: `live_events.player_name`
- Team: `live_events.team`
- Inning/score from `pre_state` (already on the row)

Clarify in a small subtitle on the page: *"Tier-1 triggers (HR/K/BB) move game state; the wager is the game LIVE_ML, not a player prop. Player props are tracked separately in lag_edges."*

This answers "where do player + team + line match up": player/team is the *trigger*, line is the *game moneyline* the model is pricing against.

## 3. Latency-arb evidence panel

New "Book Latency" card on the dashboard:

- For last 24h fires: histogram + median of `feed_ts − book_last_move_ts` (ms). This is the literal "book is N ms behind the event" measurement.
- Counter tiles:
  - `book_reacted` skips (book moved before our feed → no arb)
  - `stale_feed` skips (our feed was the slow one)
  - Successful fires (book lagged us by ≥0ms and edge ≥ 3%)
- Bonus: pull `lag_edges` last 24h (the player-prop latency engine) and show `excess_lag_seconds` p50/p90 alongside, so you see both engines' latency picture in one place.

## Technical notes

- Files touched: `src/pages/admin/MlbFairPriceDashboard.tsx` only.
- New queries:
  - `mlb_fair_price_events` filtered by `gate_decision IN ('fire','skip')` last 24h with `book_id, book_price, opposite_book_price, book_last_move_ts, feed_ts, skip_reason` (all already on the table).
  - `live_events` last 24h MLB rows for player/team join.
  - `lag_edges` last 24h for the secondary latency panel.
- All 15s polling, admin-gated, no writes.

## Out of scope

- No new player-prop fair-price logic (Tier-2 is deferred per `mem://logic/betting/mlb-fair-price-v1`).
- No schema changes (could add `live_event_id` FK later if join-by-key proves flaky).
- No engine changes.
