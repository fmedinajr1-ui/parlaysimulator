---
name: Matchup intelligence cross-ref pipeline
description: Shared matchup_intelligence loader/adjuster used by lottery-1500-builder and parlay-engine-v2, with self-healing refresher
type: feature
---

`_shared/matchup-xref.ts` is the single source of truth for matchup_intelligence cross-referencing. Exposes `loadMatchupMap`, `lookupMatchup`, `matchupAdjustment` (returns `{adj, blocked, note, row}`), `buildMatchupNote`, `etTodayTomorrow`.

**Adjustment math (locked):** normalized matchup_score (±1 from ±5) × 0.07, plus ±0.05 from `confidence_adjustment`, minus 0.05 on OVER when `blowout_risk ≥ 0.7`. Hard-skip when `is_blocked=true`.

**Refresher:** `matchup-intelligence-refresh` builds NBA-only rows from `unified_props` × `team_defensive_ratings` × `game_environment` × `bdl_player_cache`. Upsert on `(player_name, prop_type, side, line, game_date)`. Cron: 7:15/13:15/19:15 ET (job `matchup-intelligence-refresh-3x-daily`).

**Self-heal:** both `lottery-1500-builder` and `parlay-engine-v2` invoke the refresher inline when `loadMatchupMap()` returns 0 rows for [today, tomorrow] ET.

When adding a new parlay engine, do NOT re-implement matchup logic — import from `_shared/matchup-xref.ts` and apply per-leg in the same shape as `parlay-engine-v2` (post-candidate-build, before slate generation). Player-only; team markets fall through.