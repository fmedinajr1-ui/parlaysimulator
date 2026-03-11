# Active Plans & Recent Changes

See `.lovable/archive/` for completed features prior to March 9, 2026.

# Universal Recency Decline Flag (L3 Gate) — IMPLEMENTED ✅ (March 9, 2026)

## Problem
Picks like Naji Marshall Over 14.5 PTS passed filters because L10 avg (17.0) cleared the line, but his last 4 games were 8, 13, 6, 4.

## Solution
Added `l3_avg` column + universal recency decline filter across ALL engines.

### Thresholds
- **HARD BLOCK (OVER)**: `l3_avg < l10_avg * 0.75` (25%+ decline)
- **HARD BLOCK (UNDER)**: `l3_avg > l10_avg * 1.25` (25%+ surge)
- **WARNING FLAG**: `l3_avg < l10_avg * 0.85` (15%+ decline, shown in broadcasts as 📉)

# NHL Matchup Intelligence Filter — IMPLEMENTED ✅ (March 11, 2026)

## Problem
NHL prop scanner fetched `nhl_team_defense_rankings` but **hardcoded matchupAdjustment to 0**. Floor lock picked purely on L10 hit rate — ignoring whether the player faces the league's best or worst defense.

## Solution
Wired prop-specific defensive/offensive matchup scoring into the scanner and floor lock orchestrator.

# Prop Type Normalization — IMPLEMENTED ✅ (March 11, 2026)

## Problem
`bot_player_performance` stored `threes` and `player_threes` as separate records, causing split "serial loser" / "proven winner" tracking.

## Solution
Added `normalizePropType()` to settlement, hit-rate rebuild, and parlay generation. Ran one-time SQL merge of existing split records.

# Streak Penalty in Weight Calibration — IMPLEMENTED ✅ (March 11, 2026)

## Problem
`calculateWeight()` ignored `current_streak`. Categories like `THREE_POINT_SHOOTER` kept weight 1.30 during a -12 cold streak.

## Solution
Added `calculateStreakPenalty()` to `calibrate-bot-weights`:
- Streak ≤ -3: penalty = streak × 0.02
- Streak ≤ -8: penalty = streak × 0.03
- Streak ≤ -15: auto-block regardless of hit rate
- Example: -12 streak → -0.36 penalty, weight drops from ~1.22 to ~0.86
