---
name: same-game-concentration
description: Parlay v2 same-game guards (0.75 cap TEMP, min-2-games hard floor at selection AND validation)
type: feature
---
Parlay engine v2 enforces same-game guards at TWO layers:

**Layer 1 — Selection (strategies.ts `bestComboToBand`):**
Returns null if the filtered candidate subset spans fewer than `min_distinct_games` (default 2). Strategies then fall through cleanly with `strategy_returned_none:<name>` instead of building rejected single-game parlays. Patched 2026-04-21 after observing 60 wasted build attempts/run when one game dominated the pool.

**Layer 2 — Validation (filters.ts):**
1. **`parlayMinDistinctGames(p, min=2)`** — hard floor. Every parlay must touch ≥2 distinct `(team|opponent)` keys. Rejection: `single_game_only`. Runs BEFORE the share check.
2. **`parlaySameGameConcentration(p, max_share=0.75)`** — TEMP loosened from 0.6 on 2026-04-21 while pool coverage was thin. Revert default to 0.6 once morning prep pipeline reliably restores full slate coverage across multiple consecutive days. Rejection: `same_game_share_<share>`.

**Pool-coverage backfill (2026-04-21 one-off):** Inserted 60 picks into `bot_daily_pick_pool` for 5 NBA games missing from the 4 AM ET build (category=`pool_backfill_2026_04_21`). Does NOT auto-repeat — tomorrow's 10 AM morning pipeline rebuilds from scratch.
