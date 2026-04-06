

# Apply Minutes Volatility Gate to Every FanDuel Prediction Engine

## What This Does
The minutes volatility gate currently only exists in `fanduel-behavior-analyzer`. This plan adds it to all prediction/parlay engines so every single FanDuel signal — whether it's a behavioral alert, prediction alert, daily parlay leg, or force-fresh pick — gets the volatile minutes check and extra buffer.

## Engines That Need the Volatility Gate

| Engine | Current State | What Changes |
|--------|--------------|--------------|
| `fanduel-behavior-analyzer` | Has volatility gate | No change |
| `fanduel-prediction-alerts` | No volatility check | Add L10 minutes lookup, warning in alerts, extra buffer in signal_factors |
| `generate-prediction-parlays` | No volatility check | Add volatility flag to parlay leg display, penalize volatile legs in scoring |
| `bot-generate-daily-parlays` | Has prop-type volatility block only | Add minutes CV check, penalize/flag volatile players in leg selection |
| `bot-force-fresh-parlays` | Has prop-type block only | Add minutes CV check, penalize volatile players |
| `bot-curated-pipeline` | None | Add volatility lookup and scoring penalty |
| `gold-signal-parlay-engine` | None | Add volatility lookup and scoring penalty |

## Implementation Per Engine

### 1. Shared Volatility Lookup Pattern (reused in each file)
Each engine will include the same volatility calculation block:
- Collect unique player names from the picks/signals
- Query `nba_player_game_logs` (and sport equivalents) for L10 minutes
- Calculate CV per player, flag `isVolatile` if CV > 20%
- Build a `volatilityMap` for fast lookup

### 2. `fanduel-prediction-alerts` (1085 lines)
- After the L10 game logs fetch (~line 252), add a minutes volatility calculation using the same `nba_player_game_logs` data already fetched
- In alert text builders (velocity spike ~line 673, take_it_now ~line 768, trap ~line 842): append `⚠️ VOLATILE MINUTES` warning line
- In `signal_factors` for each record: add `is_volatile_minutes`, `minutes_cv`, `minutes_avg`
- Alt line buffer: add `getBuffer` + `calcAltLine` helpers (same as behavior-analyzer), show `🎯 Alt Line Edge` in every alert, with extra +2 buffer for volatile players

### 3. `generate-prediction-parlays`
- After fetching today's signals (~line 30), query game logs for all player names
- Build volatility map, add `is_volatile` flag to each `EnrichedPick`
- Penalize volatile picks in scoring: `score *= 0.7` for volatile players
- In Telegram formatter `formatLeg`: add `⚠️ Volatile Minutes (CV X%)` line

### 4. `bot-generate-daily-parlays`
- After enriching sweet spots, query game logs for all player names in the pool
- Build volatility map
- In leg selection loops: add scoring penalty (-15 points) for volatile players, similar to existing `ROLE_PLAYER_VOLATILE` in smart-check
- Add `⚠️ CV X%` tag to volatile legs in Telegram output

### 5. `bot-force-fresh-parlays`
- Same pattern: volatility lookup after player collection
- Scoring penalty for volatile players
- Tag in Telegram output

### 6. `bot-curated-pipeline` and `gold-signal-parlay-engine`
- Same pattern applied

## Scope
- 6 edge function files modified (behavior-analyzer stays as-is)
- No migration needed — volatility data stored in existing `signal_factors` JSONB
- Each file gets ~60-80 lines of volatility logic added

