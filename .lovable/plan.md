## Goal

Re-enable Scout hedge alerts and broaden the player-hedge scope from NBA-only to MLB as well, so MLB pitcher + batter prop reversals also trigger 🛡️ HEDGE Telegrams.

Today the engine + monitor are sport-agnostic in code, but the **event→market relevance map** and **direction map** only know NBA verbs (ASSIST/SHOT_MADE/FOUL…). MLB events sitting in `live_events` will be ignored. This phase fixes that and turns the monitor back on.

## Scope

In:
- Add MLB event vocabulary and market vocabulary to the Scout Speed shared modules.
- Extend `eventDirection()` so MLB events have correct intended_direction (drives reverse-delta math).
- Re-enable the `scout-speed-hedge-monitor` cron (currently off / paused per request).
- Keep the existing 0.5 line-unit reverse threshold but make it per-market so HR/SB (small lines) and K/total_bases (larger lines) each get a sane floor.
- 5 new Deno tests covering MLB direction + relevance + hedge fire.

Out (deferred):
- Building an MLB live-event ingest source — assumes events are already (or will be) POSTed to `scout-live-edge` with `sport: "MLB"`.
- New UI columns. The existing 🛡️ Hedge badge on `/admin/scout-speed` already renders for any sport.
- Retraining the learned model on MLB data — cold-start heuristic carries MLB until ≥200 resolved MLB edges exist.

## Plan

### 1. MLB event + market vocabulary (`_shared/scout-speed/relevance.ts`)

Add MLB event types and the player/team markets each one front-runs:

```text
STRIKEOUT      → player_strikeouts, player_hits, live_total, team_score
WALK           → player_strikeouts, player_walks, live_total
HIT            → player_hits, player_total_bases, player_rbi, player_runs, live_total, team_score
HOME_RUN       → player_home_runs, player_hits, player_total_bases, player_rbi, player_runs, live_total, team_score
RBI            → player_rbi, player_runs, live_total, team_score
RUN_SCORED     → player_runs, live_total, team_score
STOLEN_BASE    → player_stolen_bases
PITCHER_PULLED → player_strikeouts, live_total, team_score
INJURY (MLB)   → all MLB player_* + live_spread     (already handled generically; verified)
```

### 2. Direction map (`_shared/scout-speed/scoring.ts`)

`eventDirection()` decides whether the predicted line move is "up" or "down", which the hedge monitor inverts to detect reversals. Add MLB rules:

- **up** (line/over more valuable): STRIKEOUT (for pitcher K market), HIT, HOME_RUN, RBI, RUN_SCORED, STOLEN_BASE, WALK (for walks-allowed market)
- **down**: PITCHER_PULLED, INJURY (already), and STRIKEOUT for batter-hit markets

Because direction is per-edge not per-event, switch `eventDirection` to take `(eventType, marketType)` so the same MLB event can fire two edges in opposite directions (e.g. STRIKEOUT pushes pitcher_K up but batter_hits down). NBA callers updated; existing tests adjusted.

Also add `impactScore` entries: HOME_RUN 1.0, STRIKEOUT 0.7, HIT 0.6, WALK 0.4, PITCHER_PULLED 0.9, STOLEN_BASE 0.6, RBI 0.7, RUN_SCORED 0.7.

### 3. Hedge monitor (`scout-speed-hedge-monitor/index.ts`)

- Replace single `HEDGE_REVERSE_THRESHOLD = 0.5` with a per-market table:

```text
player_home_runs, player_stolen_bases       → 0.5
player_strikeouts, player_total_bases       → 0.5
player_hits, player_rbi, player_runs        → 0.5
player_pts/ast/reb/pra (NBA, unchanged)     → 0.5
live_total (MLB runs)                       → 0.5
live_spread                                 → 0.5
```
(Same numbers today, but the table makes per-market tuning trivial later.)

- Keep the 20-min lookback and idempotent `hedge_fired_at IS NULL` update.
- No schema change.

### 4. Re-enable the cron

`scout-speed-hedge-monitor` cron job is currently paused. Re-create it on a 1-minute cadence using `supabase--insert` (cron lives in the data API, not migrations):

```text
cron name: scout-speed-hedge-monitor-1m
schedule:  * * * * *
action:    net.http_post → /functions/v1/scout-speed-hedge-monitor
```

### 5. Telegram

`telegram-format.ts → formatHedgeAlert` already uses the `marketLabel()` map. Add MLB labels so messages say "Strikeouts", "Home Runs", "Stolen Bases", "Total Bases", "RBIs", "Runs", "Hits", "Walks" — never abbreviations (per core memory rule).

### 6. Tests (`_shared/scout-speed/scout-speed_test.ts`)

5 new Deno tests:

1. `eventDirection("STRIKEOUT","player_strikeouts") === "up"` and `("STRIKEOUT","player_hits") === "down"`
2. `isRelevant("HOME_RUN","player_home_runs") === true`; `("HOME_RUN","player_ast") === false`
3. `reverseDelta("up", 6.5, 5.5) === 1.0` for MLB K line drop after PITCHER_PULLED
4. `formatHedgeAlert` for MLB HR prop renders "Home Runs" full label + correct OVER/UNDER flip
5. Per-market threshold lookup returns 0.5 for `player_home_runs`, falls back to default for unknown market

### 7. Memory

Update `mem/features/scout/speed-edge.md`:
- Note Phase 2 covers MLB + NBA player hedges.
- Document new MLB event vocabulary + signature change to `eventDirection(eventType, marketType)`.
- Note per-market threshold table location.

## Technical notes

- No DB migration needed — `lag_edges.intended_direction` is already free-text/`up|down`, `edge_type` is already free-text market name.
- `scout-live-edge` callsite for `eventDirection` becomes `eventDirection(event.event_type, market.market_type)` inside the per-market loop — direction is now resolved AFTER we know which market is being evaluated.
- Hedge monitor doesn't need the new signature; it just reads `intended_direction` off the row.
- The MLB live-event POSTer must send `sport: "MLB"` + one of the event types above, with `player_name` set for player events. If/when an ingest pipeline lands, no further engine change should be required.

## Risk / rollback

- If MLB events arrive with unmapped types, they're silently dropped (same as today's unknown NBA types) — safe default.
- To roll back, pause the new cron and revert the three shared files; `lag_edges` rows stay valid.
