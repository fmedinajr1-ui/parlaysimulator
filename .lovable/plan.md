# `/rankings` + `/weekly` Rundown — IMPLEMENTED ✅

## `/rankings` Command
- `/rankings` — Summary of top 10 NBA teams (OVR, PTS↑, PTS↓, REB↑, REB↓) + top 10 NHL teams (GAR, GFR, SAR, SFR)
- `/rankings [TEAM]` — Single team profile across all categories (NBA + NHL)
- Available to both admin and customer users

## `/weekly` Command  
- Past week recap: W/L record, P&L, best/worst day, strategy breakdown, hottest/coldest categories
- Forward lean recommendations: cross-references `bot_category_weights` hit rates with `team_defense_rankings` weak defenses
- Automated Sunday 10:00 AM ET broadcast to all active users via `pg_cron`

---

# Daily NHL Floor Lock + NBA Matchup Broadcast — IMPLEMENTED ✅

## Cron Schedule

| Job | Time (ET) | UTC Cron | Function |
|-----|-----------|----------|----------|
| NBA L10 Refresh & Rebuild | 10:00 AM | `0 15 * * *` | `refresh-l10-and-rebuild` (existing) |
| NHL Data Refresh + Floor Lock Build + Telegram | 12:00 PM | `0 16 * * *` | `nhl-floor-lock-daily` |
| NBA Bidirectional Matchup Broadcast | 1:30 PM | `30 17 * * *` | `nba-matchup-daily-broadcast` |

## New Functions

### `nhl-floor-lock-daily`
Orchestrator that:
1. Refreshes NHL game logs (`nhl-stats-fetcher`)
2. Refreshes team defense rankings (`nhl-team-defense-rankings-fetcher`)
3. Scans sweet spots (`nhl-prop-sweet-spots-scanner`)
4. Builds 4-5 leg floor lock parlay from NHL picks with 100% L10 hit rate + `l10_min >= 1`
5. Falls back to 80%+ hit rate if insufficient 100% candidates
6. Inserts to `bot_daily_parlays` (strategy: `nhl_floor_lock`)
7. Broadcasts formatted parlay to Telegram

### `nba-matchup-daily-broadcast`
1. Runs bidirectional `bot-matchup-defense-scanner`
2. Queries `bot_research_findings` for today's matchup scan
3. Categorizes into elite/prime/favorable/avoid tiers
4. **Cross-references with `category_sweet_spots` for player-level validation**
5. Broadcasts formatted report to Telegram with player targets vs environment-only flags

# Bidirectional Scanner — Player-Level Validation Fix ✅ (March 6, 2026)

## Problem
Scanner correctly identified team-level matchup signals (e.g., WAS Rebounds Elite vs UTA) but these were misapplied as blanket OVER recommendations for individual bench players who don't have the usage/ceiling to benefit.

## Fix
1. **Scanner (`bot-matchup-defense-scanner`)**: Now cross-references `category_sweet_spots` to find specific players whose L10 averages support each team signal. Each recommendation now includes `player_backed: boolean` and `player_targets: PlayerTarget[]`.
2. **Broadcast (`nba-matchup-daily-broadcast`)**: Shows player-backed targets with L10 stats (avg, hit rate, floor) under each matchup. Environment-only signals (no player backing) are flagged with ⚠️ warning.

## New Telegram Format
```
🔥 ELITE (3 — 1 player-backed)
  • WAS Rebounds vs UTA DEF (Score: 29.0)
    OFF #2 vs DEF #29
      ✅ Kyle Kuzma OVER 6.5 (L10: 8.2 avg, 90% hit, floor 5)
      ⚠️ Environment only for low-usage players
```

# Floor & Ceiling Parlay Tiers — IMPLEMENTED ✅

## What Was Added
Two new parlay strategies using L10 game log floor/ceiling data:

### 🔒 Floor Lock (Safe Parlays)
- **Concept**: Only picks where the player's worst game in L10 still clears the betting line
- **Gate**: `l10_min >= line * 0.85` for overs (relaxed from 100% — 0 candidates with real sportsbook lines at strict threshold), `l10_max <= line * 1.15` for unders
- **Safety backstop**: Requires `l10_hit_rate >= 80%` to ensure consistency
- **Line**: Standard sportsbook line (safety IS the floor guarantee)
- **Profiles**: 4 execution (70%+ hit rate), 4 exploration (60%+ hit rate)

### 🎯 Ceiling Shot (Risky Parlays)
- **Concept**: Alt lines near the player's L10 ceiling with plus-money odds
- **Gate**: `l10_max >= line * 1.3` (ceiling must be 30%+ above standard line)
- **Line**: Alternate line near L10 max with odds >= -130 (relaxed from > +100)
- **Fallback**: If no alt lines available but `l10_max >= line * 1.5`, use standard line
- **Profiles**: 3 execution (55%+ hit rate), 4 exploration (45%+ hit rate)

### 🎲 Optimal Combo (NEW — Combinatorial Optimizer)
- **Concept**: Instead of greedy sort-and-take-top-N, enumerate ALL valid 3/4-leg combinations and pick the ones with highest combined probability
- **Gate**: L10 hit rate >= 70% (execution) / 60% (exploration)
- **Scoring**: Product of individual L10 hit rates (e.g., 90% × 100% × 90% = 81% combined)
- **Correlation check**: No same player, max 4 same category
- **Diversity**: Returns top 5 non-overlapping combos (no player reuse across combos)
- **Profiles**: 3 execution (NBA 70%, NBA 65% 4-leg, all 70%), 3 exploration (NBA 60%, NBA 55% 4-leg, all 60%)

## Profile Ordering Fix (March 5, 2026)
optimal_combo → floor_lock → ceiling_shot profiles at **top** of both exploration and execution arrays.

## Priority Strategy Bypass
All three strategies (`optimal_combo`, `floor_lock`, `ceiling_shot`) added to PRIORITY_STRATEGIES and POST_TRIM_PRIORITY sets — they bypass the 30% strategy diversity cap.

## Timeout Guard
140s wall-clock guard in profile iteration loop. Logs remaining skipped profiles when triggered.

## Files Changed
1. `supabase/functions/bot-generate-daily-parlays/index.ts`:
   - Added `buildOptimalComboParlays()` combinatorial optimizer function
   - Added `optimal_combo` strategy detection + pre-assembled parlay creation in profile loop
   - Relaxed `selectCeilingLine()` odds gate from `> +100` to `>= -130`
   - Added ceiling shot fallback for `l10_max >= line * 1.5` without alt lines
   - Added `optimal_combo`, `floor_lock`, `ceiling_shot` to PRIORITY_STRATEGIES + POST_TRIM_PRIORITY

# NHL Prop Engine — Data Layers for Composite Scores & Hit Rates — IMPLEMENTED ✅

## What Was Added

### 1. NHL Prop Sweet Spots Scanner (NEW)
- **Edge Function**: `nhl-prop-sweet-spots-scanner`
- Pulls active NHL player props from `unified_props` (sport: `icehockey_nhl`)
- Cross-references against `nhl_player_game_logs` (skaters) and `nhl_goalie_game_logs` (goalies)
- Computes L10 hit rate, avg, median, min/max, std dev for each prop
- Classifies into NHL categories: `NHL_SHOTS_ON_GOAL`, `NHL_GOALS_SCORER`, `NHL_ASSISTS`, `NHL_POINTS`, `NHL_GOALIE_SAVES`, `NHL_BLOCKED_SHOTS`, `NHL_POWER_PLAY_POINTS`
- Writes qualifying picks (50%+ L10 hit rate) to `category_sweet_spots`
- Quality tiers: elite (80%+), strong (70%+), solid (60%+), marginal (50%+)

### 2. NHL Mispriced Lines Detection
- Added full NHL analysis block to `detect-mispriced-lines`
- NHL prop-to-stat mapping for skaters and goalies
- Defense-adjusted projections using `nhl_team_defense_rankings`
- Prop-specific defense routing: SOG → `shots_against_rank`, goals → `goals_against_rank`, saves → `shots_for_rank` (opponent shot generation)
- Results fork to `mispriced_lines` (15%+ edge) and `correct_priced_lines` (3-15% edge)

### 3. NHL Category Weights
- Seeded 14 entries in `bot_category_weights` for all NHL prop categories
- Initial weights: Saves OVER boosted (1.3), SOG OVER boosted (1.2), Points OVER slightly boosted (1.1)
- Weights will auto-calibrate as outcomes are tracked

## Files Changed
1. `supabase/functions/nhl-prop-sweet-spots-scanner/index.ts` (new) — core L10 scanner
2. `supabase/functions/detect-mispriced-lines/index.ts` — added NHL analysis block
3. `supabase/config.toml` — registered new function
4. `bot_category_weights` table — seeded NHL categories

# Cross-Sport NHL+MLB Optimal Combo Parlays — IMPLEMENTED ✅

## What Was Added
Phase 2D in `nhl-floor-lock-daily` that creates mixed-sport parlays combining NHL and MLB picks.

### How It Works
1. After NHL phases complete, fetches today's MLB candidates from `category_sweet_spots` (category LIKE `MLB_%`)
2. Merges NHL pool (from Phase 2B) + MLB pool, deduplicates by player, caps at 25
3. Builds combos using C(n,3) and C(n,4) with a **mixed-sport filter**: every combo must have at least 1 NHL leg AND at least 1 MLB leg
4. Inserts to `bot_daily_parlays` with strategy `cross_sport_optimal`

### Strategy Profiles
- **Execution**: 3-leg, all legs ≥ 70% L10 hit rate, mixed sport
- **Exploration**: 3-leg at 60%+ and 4-leg at 60%+, mixed sport

### Broadcast
Included in the consolidated NHL daily broadcast with 🌐 emoji. Header updated to "NHL + MLB DAILY PARLAYS".

### Files Changed
1. `supabase/functions/nhl-floor-lock-daily/index.ts` — added Phase 2D
2. `supabase/functions/broadcast-new-strategies/index.ts` — added `cross_sport_optimal` to whitelist

# Track All Parlays + Reconfigure Stakes — IMPLEMENTED ✅

## What Changed

### 1. Stake Reconfiguration
- Execution: $100 → **$250**
- Validation: $50 → **$125**
- Exploration: $20 → **$50**
- Bankroll Doubler: $10 → **$25**
- Baselines updated to match

### 2. NHL Floor Lock Daily — Stake Integration
- Reads `bot_stake_config` at start of each run
- All 4 strategies now include `simulated_stake` and `simulated_payout`:
  - Floor Lock & Optimal Combo (execution) → `execution_stake` ($250)
  - Ceiling Shot & Cross-Sport exploration → `exploration_stake` ($50)

### 3. Bidirectional Bench Under Parlay Tracking
- `nba-matchup-daily-broadcast` now converts bench_under targets (80%+ L10 hit rate) into trackable 3-leg parlays
- Inserts into `bot_daily_parlays` with `strategy_name: 'bidirectional_bench_under'`, tier `execution`
- Up to 2 non-overlapping parlays per day, with proper stakes
- Settlement engine auto-resolves via existing `bot-settle-and-learn`

### Files Changed
1. `supabase/functions/nhl-floor-lock-daily/index.ts` — stake config loading + all inserts
2. `supabase/functions/nba-matchup-daily-broadcast/index.ts` — bench under parlay creation
3. `bot_stake_config` table — updated stakes
