---
name: Multi-sport Sharp Money pipeline
description: Architecture for automated price-edge tracking + settlement across MLB, WNBA, tennis, soccer
type: feature
---

## Pipeline
1. `multisport-player-props-ingest` (every 30 min) — pulls MLB/WNBA/Soccer player-prop lines from The Odds API → `unified_props`. Tennis runs via existing `tennis-props-sync`.
2. `sharp-tracker-auto-ingest` (every 10 min) — reads active rows from `unified_props` for tracked sports (`baseball_mlb`, `basketball_wnba`, `tennis_*`, `soccer_*`). For each `(sport, player, prop, line)`:
   - Inserts opening snapshot into `sharp_line_tracker` (input_method='auto') on first sight.
   - Updates current_line/prices and re-evaluates direction on subsequent runs.
   - Mirrors into `engine_live_tracker` (engine_name='Sharp Money') only when vig-free price edge ≥ per-sport floor.
3. `mlb-engine-bridge` (every 15 min) — mirrors `mlb_engine_picks` (Bot Exploration) into `engine_live_tracker` so legacy MLB bot picks are graded with the unified settler.
4. `mlb-engine-settler` — grades MLB picks against `mlb_player_game_logs`.
5. `tennis-engine-settler` (hourly) — scrapes TennisAbstract jsfrags for final scores. Supports `total_games`, `player_total_games`, `player_games_won`, `player_total_sets`. Retired matches → status='void'.
6. `soccer-engine-settler` — scaffold; activates once `soccer_player_match_stats` ingest is wired.

## Per-sport vig-free edge floors
`baseball_mlb` 3pp · `basketball_wnba` 4pp · `tennis_atp`/`tennis_wta` 4pp · `soccer_epl`/`soccer_ucl`/`soccer_laliga` 4pp · `soccer_mls` 5pp · `mma` 5pp · default 5pp.

## DB constraints (relaxed in migration 2026-06-09)
- `sharp_line_tracker.input_method` now accepts `'auto'` in addition to `'manual'`/`'scan'`.
- `sharp_line_tracker.sport` allowlist expanded to MLB/WNBA/tennis/soccer/MMA/golf/NHL/NCAAF.
- `sharp_line_tracker.ai_direction` may be NULL (when no signal fires yet).

## Known data gaps
- The Odds API quota (100k/mo) was exhausted on 2026-06-09. Multisport ingest will start populating real player props once quota resets or the plan is upgraded. The architecture is fully deployed and waiting.
- Soccer stats ingestion (`soccer_player_match_stats`) still needs an api-football or football-data.org key before `soccer-engine-settler` can grade picks.
- Tennis sport keys on The Odds API are tournament-specific (e.g. `tennis_atp_monte_carlo_masters`), discovered dynamically by `tennis-props-sync`.

## Cron schedule (job names)
`sharp-tracker-auto-ingest-10min` · `mlb-engine-bridge-15min` · `tennis-engine-settler-hourly` · `multisport-props-ingest-30min` · `tennis-props-sync-30min`.