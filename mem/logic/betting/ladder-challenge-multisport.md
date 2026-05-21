---
name: Ladder Challenge multi-sport engine
description: nba-ladder-challenge runs daily as a multi-sport (MLB+NBA+NHL) Lock of the Day with tiered safety gates, sport-specific adapters, and guaranteed Telegram delivery.
type: feature
---
- **Route**: `supabase/functions/nba-ladder-challenge/index.ts` (route name preserved for cron `daily-ladder-challenge` at 14:30 ET = 19:30 UTC).
- **Adapters** run in parallel: `collectNbaCandidates` (Odds API live lines + `nba_player_game_logs`) and `collectMlbCandidates` (`unified_props` for live lines + `mlb_player_game_logs`). NHL is a future slot.
- **Tier system**: `lock` (≥90% hit, floor strictly beats line, median clears by ≥1), `strong` (≥80%, floor meets line, median at/above), `lean` (≥70% with avg favoring side). First non-empty tier wins.
- **Quality gates** (`passesQualityGates`): odds floor at **-250** max (no worse), OVER requires ≥2 nonzero games, UNDER rejects when all values are 0 (proxy for missing/dead game logs — common with `category_sweet_spots` MLB RBI Unders).
- **Selection**: sort by `(tier_rank, safety_score)` then tiebreak by `|odds|` (prefer less-juiced).
- **Persistence**: single-leg row in `bot_daily_parlays` with `strategy_name='ladder_challenge'`, `tier` = `execution` for lock else `strong`/`lean`, `simulated_stake=100`. Leg JSON now carries `sport`, `side`, `prop_label`, `game`, `player_team`, `opponent`.
- **Telegram**: always sends via `bot-send-telegram` `type:'ladder_challenge'`. Header reflects tier + sport emoji (⚾/🏀/🏒). When no candidate qualifies in any sport, an admin-only "markets thin" note fires so the channel never goes silent.
- **Force flag**: `?force=1` bypasses one-per-day dedup for manual re-tests.
