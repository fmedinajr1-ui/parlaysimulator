---
name: MLB engine settler
description: Grades pending MLB engine_live_tracker picks vs mlb_player_game_logs; soccer scaffold + unified-props side-picker companion
type: feature
---

## mlb-engine-settler
Settles engine_live_tracker rows where sport ILIKE '%mlb%', status='pending', side<>'neutral', line IS NOT NULL. Matches player_name (lowercase) to mlb_player_game_logs within days_back (default 3). Picks first log with game_date >= created_at, else most recent. Supports pitcher_strikeouts/hits_allowed/earned_runs/outs, batter_hits/home_runs/rbis/total_bases/stolen_bases/runs/walks/hits_runs_rbis. batter_singles unsupported (needs 2B/3B). Body: {days_back?, dry_run?}.

## unified-props-side-picker
Fixes upstream recommended_side=null in unified_props. Cascade: true_line vs current_line (>=0.25) -> sharp_money_score sign -> hit_rate_score vs 0.5 -> composite_score sign. Propagates side to matching engine_live_tracker neutral rows so per-sport settler can grade them. Body: {sport?, dry_run?}.

## soccer-engine-settler (Phase 1)
Tables soccer_match_results + soccer_player_match_stats live. Grades player props (goals/assists/shots/passes/tackles/cards) once ingestion lands. Team markets currently 'unsupported'.
