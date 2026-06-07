
# MLB Fair-Price Layer — Latency Arb (v1)

Build the spec into the existing Scout Speed Edge pipeline. **Ship Tier-1 only, LIVE_ML only, log-only WARN for 2 weeks** before any auto-bet. Tier-2 (1B/2B/3B/IP_OUT) and LIVE_TOTAL come later behind a flag.

**Delivery: all alerts go to admin Telegram only (`admin_only: true`).** No customer/public broadcast in v1 — this is a measurement phase.

## Scope (v1)

In:
- State model (bases × outs × inning × half × scoreDiff × battingTeam)
- Deterministic transitions for HR, K, BB
- Interim parametric WP (logistic w/ unfit β) — every alert tagged `WARN`, never auto-fire
- ΔWP-based edge for `LIVE_ML` only
- Gate integration with existing `scout-live-edge` (latency window, book-reacted check, liquidity)
- Logging to a new `mlb_fair_price_events` table for calibration
- Telegram delivery via existing `bot-send-telegram` with `admin_only: true`, `type: "mlb_fair_price"`

Out (deferred behind `v2Enabled` flag):
- Tier-2 events (1B/2B/3B/IP_OUT) — need resolved-play signal
- LIVE_TOTAL (needs RE24 refit for current run env)
- RUN_LINE, player props
- Empirical WP lookup (build from Retrosheet after logging period)
- Any non-admin / customer-facing alert channel

## Files to add

```
supabase/functions/_shared/mlb-fair-price/
  state.ts          — BaseState enum, GameState type, applyTransition(HR/K/BB)
  re24.ts           — RE24 table (league-avg, marked TODO: refit)
  win-prob.ts       — interim logistic winProb() w/ unfit β + null guard
  edge.ts           — fairPriceLiveML(), deVig(), computeEdge()
  constants.ts      — MIN_EV_PCT=0.03, MAX_SCORE_DIFF=8, REG_INNINGS=9,
                      MIN_LIQUIDITY=50, STALE_FEED_MS=4000
  mlb-fair-price_test.ts  — 5 tests (HR transition, K w/ 3rd out flip,
                      BB force-in w/ bases loaded, WP null guard, stale-feed skip)
```

## Files to modify

- `supabase/functions/mlb-live-events-ingest/index.ts`
  - Emit pre-event `GameState` snapshot + `feedTs` (monotonic ms) alongside each Tier-1 event posted to `scout-live-edge`
  - Add `bases`, `outs`, `inning`, `half`, `score_diff`, `batting_team` to the payload

- `supabase/functions/scout-live-edge/index.ts`
  - On Tier-1 events: build `statePost = applyTransition(statePre, evt)`
  - Pull latest book line for `LIVE_ML`, skip if `book.lastMoveTs > evt.feedTs` (book already reacted)
  - Compute `edge = winProb(statePost) − deVig(book.implied)`
  - Run existing gate (latency p90, decision latency, acceptance delay, MIN_LIQUIDITY)
  - Persist every evaluation (fire or skip + reason) to `mlb_fair_price_events`
  - **All alerts forced to `severity: "WARN"`** until WP is calibrated — never `BLOCK`/auto-bet
  - **Telegram send: `admin_only: true` always**, routed through `bot-send-telegram` with `type: "mlb_fair_price"`. No customer recipient list, no public channel.
  - Gate behind `MLB_FAIR_PRICE_ENABLED` flag in `system_config`

## DB migration

`mlb_fair_price_events` (log-only, admin-visible):
- id, game_id, event_type, feed_ts, event_time
- pre_state jsonb, post_state jsonb
- wp_pre, wp_post, delta_wp
- book_id, book_implied, book_implied_devig, book_last_move_ts
- edge, ev_pct, ttl_ms
- gate_decision (fire/skip), skip_reason
- telegram_sent bool, telegram_admin_only bool (always true in v1)
- created_at

GRANTs: `service_role` full; `authenticated` select gated by `has_role(auth.uid(), 'admin')` via RLS. No `anon` grant.

## Build order (mirrors spec §8)

1. State model + Tier-1 transitions + tests
2. Interim WP (logistic, unfit β) → returns null when uncalibrated unless flag set
3. Wire LIVE_ML edge + gate into `scout-live-edge`, log-only WARN, admin-only Telegram, 2-week observation
4. After logs accumulate: measure realized lag windows + per-book `acceptanceDelayMs`
5. (Later PR) Empirical WP lookup from Retrosheet; flip from WARN → live; only then discuss broader delivery
6. (Later PR) Tier-2 events + LIVE_TOTAL behind `v2Enabled`

## Risks / guardrails

- **Uncalibrated WP = phantom edge**: enforced WARN-only, admin Telegram only, no customer broadcast, no bet creation
- **Stale game feed**: drop events with `now - feedTs > STALE_FEED_MS`
- **Book already reacted**: skip when `book.lastMoveTs > evt.feedTs`
- **Missing acceptanceDelayMs**: treat book as `exploitable=false`
- **Ambiguous play state** (Tier-2): never transition on a guess — Tier-2 stays off

## Testing (per project rule: 5 tests minimum)

1. HR with runners on 1B+3B → bases EMPTY, +3 runs, outs unchanged
2. K with 2 outs → outs=3 → half flips, bases reset, batting team swaps
3. BB with bases LOADED → +1 run, bases still LOADED, batter→1B
4. `winProb()` returns null when β not calibrated AND flag off → no alert fires
5. Event with `feedTs` older than 4s → skipped, logged with `skip_reason=stale_feed`

Plus integration check: book line with `lastMoveTs > evt.feedTs` → `skip_reason=book_reacted`; and a Telegram delivery test asserting `admin_only=true` on every send.

## Acknowledgement

This is a measurement-and-logging PR, not a money-making PR. All alerts go to admin Telegram only. The goal is to populate `mlb_fair_price_events` so we can fit β, build the empirical WP lookup, and characterize per-book latency. Nothing in v1 will place a bet or notify customers.
