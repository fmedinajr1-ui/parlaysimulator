## Per-Book Latency Leaderboard — using real `mlb_fair_price_events` data

Add a new card to `/admin/mlb-fair-price` that ranks each sportsbook by how slow it was to react to live game events when we fired. Pure UI on data already polled every 15s — no engine, schema, or cron changes.

### Data source (real, no mocks)

Already loaded by the existing `load()` call:
- `mlb_fair_price_events` rows from the last 24h with `book_id`, `book_price`, `feed_ts`, `book_last_move_ts`, `gate_decision`, `skip_reason`.

Per-book aggregation (client-side, in a new `perBookLatency` `useMemo`):
- Group rows by `book_id` (skip null).
- For `gate_decision='fire'` rows with both timestamps → `lag_ms = feed_ts − book_last_move_ts`.
- Compute `median`, `p90`, `max` per book.
- For `gate_decision='skip'` rows → count `skip_reason='book_reacted'` (book beat us) and `'stale_feed'` (our feed lagged) per book.
- Compute `real_line_pct` = % of book's fires where `book_price` is finite.
- Books with `< 5` fires → bucketed into a single `(low-volume)` row to keep the ranking honest.

### UI

New `<Card>` placed directly under the existing "Book latency (24h)" card.

Title: **Per-book latency leaderboard (24h)**
Subtitle: *Higher median = book's published line is further behind the live event when we fire. These are the books most exposed to latency arb.*

Table columns:
| Book | Fires | Median | p90 | Max | book_reacted | stale_feed | Real-line % |

Rows sorted by `median` descending. Each row's median cell shows a horizontal bar scaled to the slowest book (`width = median / slowest`). Color rules on median:
- `≥ 2000ms` → red
- `1000–1999ms` → amber
- `< 1000ms` → green

Low-volume books collapse to a footer row showing aggregate counts.

### Files touched

- `src/pages/admin/MlbFairPriceDashboard.tsx` only — add `perBookLatency` memo + the new `<Card>` after the existing Book-Latency card.

### Out of scope

- No per-market-type split (Fair-Price v1 fires `live_ml` only).
- No historical window beyond the dashboard's 24h.
- No changes to `lag_edges` (player-prop) tile.
