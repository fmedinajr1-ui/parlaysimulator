## What's broken

The Cascade and Take-It-Now alert generator was removed from the codebase in a prior cleanup. As a result:

- Last `cascade` signal: **2026-04-21**
- Last `snapback_candidate` (Take-It-Now): **2026-04-13**
- Last `velocity_spike`: **2026-04-20**
- Last row in `line_movements` (upstream feed for these alerts): **2026-04-21 16:00 UTC**

There is **no active cron job** producing any of these signals, and the underlying line-movement collector has also been silent for ~5 days. Memory files referenced in `mem/index.md` (e.g. `mem://logic/betting/take-it-now-logic`) no longer exist on disk.

The `fanduel_prediction_alerts` table, RLS, and downstream consumers (accuracy reports, parlay engine) are all still wired up — only the producer is missing.

## Goal

Bring back a multi-sport alerts engine that writes `cascade`, `take_it_now`, and `velocity_spike` signals into `fanduel_prediction_alerts` and ships qualifying alerts to Telegram. Accuracy floor: **60%**, matching the parlay engine.

## Plan

### 1. Restore the upstream line-movement feed

- Inspect `prop-sharp-sync` (cron `*/15 * * * *`) and confirm why it stopped writing to `line_movements` after Apr 21.
- Inspect `unified-live-feed` (cron `*/30 * * * *`) for the same.
- Fix whichever fetcher is failing (likely an API key, schema drift, or sport-window logic) so fresh rows resume flowing.

### 2. Build the new alerts engine: `signal-alert-engine`

A single edge function that runs every 15 minutes during slate hours and emits all three signal types across MLB, NBA, NHL.

**Cascade detector**
- Group recent line movements by `(event_id, prop_type, direction)`.
- A cascade fires when ≥3 distinct players on the same team move the same direction within a 60-min window (e.g. 3+ Braves hitters' RBI Unders all shorten together).
- Cross-references `mlb-prop-cross-reference` for MLB to enforce the existing pitcher-quality and L10 gates.
- Confidence is the average historical accuracy of its inputs, floored at 60%.

**Take-It-Now (snapback) detector**
- Detects sharp post-open reversals: a line that drifted ≥X% one way, then snapped back ≥Y% within ~20 minutes.
- Reuses the directional logic memorialised in `mem://logic/betting/take-it-now-logic`: TAKE = shortening, FADE = lengthening; suppresses on ≥10-pt spreads and on poison-signal markets.
- Confidence floor 60%.

**Velocity Spike detector**
- Flags single-player props with abnormal price velocity (Δprice / Δt) vs. the 7-day baseline for that prop type.
- Requires correlated movement on at least one peer book (no isolated single-book spikes).

All three writers populate `fanduel_prediction_alerts` with `signal_type`, `confidence`, `metadata`, and a stable hash key for dedupe (2-hour cross-run window, per existing memory rule).

### 3. Telegram delivery: `signal-alert-telegram`

- Pulls unsent rows from `fanduel_prediction_alerts` where `confidence ≥ 60` and not already broadcast.
- Formats them in the conversational/narrative style we restored for parlays (per `mem://telegram/communication-style`).
- Inserts into a new `bot_signal_broadcasts` table (FK to alert id, `chat_id`, `parlay_date`, `sent_at`) — same self-verifying pattern we just built for parlay broadcasts.
- Dedupes by `(alert_id, chat_id)`.

### 4. Cron + audit

- Schedule `signal-alert-engine` every 15 min during 13:00–03:00 UTC (slate window).
- Schedule `signal-alert-telegram` every 5 min in the same window.
- Add a `v_signal_broadcast_audit` view mirroring the parlay one (flags `MISSING_ALERT`, `STORED_DATE_MISMATCH`, `SEND_DATE_DRIFT`).

### 5. Memory + docs

- Recreate `mem://logic/betting/cascade-engine.md`, `mem://logic/betting/take-it-now-logic.md`, `mem://logic/betting/velocity-spike.md` with the actual rules + 60% floor.
- Update `mem://index.md` to point at the real files.

## Technical details

| Component | Type | Schedule |
|---|---|---|
| `signal-alert-engine` | new edge function | `*/15 13-23,0-3 * * *` |
| `signal-alert-telegram` | new edge function | `*/5 13-23,0-3 * * *` |
| `bot_signal_broadcasts` | new table + RLS | n/a |
| `v_signal_broadcast_audit` | new view (security_invoker) | n/a |
| `prop-sharp-sync` / `unified-live-feed` | bug fix | existing crons |

Signal types written: `cascade`, `take_it_now` (replacing the old `snapback_candidate` label for clarity), `velocity_spike`. Existing `snapback_candidate` rows stay readable for historical accuracy reports.

Confidence gate: `confidence >= 60` for Telegram delivery — applied in both the engine (skip writes below 60 on cascade) and the Telegram broadcaster (final filter).

Dedupe: hash of `(signal_type, event_id, prop_type, direction, player_name)` with a 2-hour TTL, matching the existing FanDuel signal-deduplication rule.

## Verification (after build)

1. Confirm `line_movements.MAX(created_at)` advances within 30 min of deploy.
2. Confirm `fanduel_prediction_alerts` shows new rows for all 3 signal types.
3. Curl `signal-alert-telegram` and confirm rows land in `bot_signal_broadcasts` and a test message hits the admin chat.
4. Run `v_signal_broadcast_audit` — expect zero `MISSING_*` or `MISMATCH` rows.

## Out of scope

- No changes to the parlay engine or its 60% confidence floor (already restored).
- No changes to RBI Unders logic.
- No changes to existing fanduel-boost crons.