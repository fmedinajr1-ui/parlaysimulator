

# Add RBI Average Filter to MLB Cascade Parlay Generator

## Problem
The generator currently uses ALL cascade picks without checking each player's actual RBI production rate. Some players may average 0 RBI (pitchers/relievers) or 1+ RBI (power hitters) — neither is ideal for Under 0.5 RBI parlays.

## Solution
Add a quality gate that cross-references each cascade pick against `mlb_player_game_logs` to compute their L10 RBI average, then only includes players averaging **0.3–0.7 RBI** (sweet spot for Under 0.5 lines). This ensures every leg is a meaningful position player with a realistic but beatable RBI rate.

## Changes

### Edit: `supabase/functions/mlb-cascade-parlay-generator/index.ts`

After pulling cascade picks (step 1) and before building the pool (step 3), add:

1. **Query L10 RBI averages** — fetch from `mlb_player_game_logs` grouped by player name for recent games
2. **Filter pool** — only keep players with avg RBI between **0.3 and 0.7** (configurable constants `MIN_AVG_RBI = 0.3`, `MAX_AVG_RBI = 0.7`, minimum 3 games logged)
3. **Log filtered count** — show how many players passed vs were removed
4. **Include avg RBI in Telegram output** — show each leg's L10 avg next to the pick for transparency

Players averaging 0.0 (pitchers, bench players) get dropped — they don't have Under 0.5 RBI lines on FanDuel. Players averaging 0.8+ get dropped — too risky for Under.

### No DB changes needed

