

## Ensure All Engines Use Fresh Defense + Offense Rankings

### Audit Summary

After tracing every engine that consumes defensive/offensive ranking data, **2 engines have gaps** that need to be updated:

### Gap 1: `prop-engine-v2` (SES Scoring Engine)

**Problem**: This engine's `calculateEnvironmentScoreV2` function only uses 3 fields from `team_defense_rankings`:
- `overall_rank`, `opp_rebounds_rank`, `opp_assists_rank`

It is **missing**:
- `opp_points_rank` and `opp_threes_rank` (prop-specific defense routing)
- All 5 offensive columns (`off_points_rank`, `off_rebounds_rank`, `off_assists_rank`, `off_threes_rank`, `off_pace_rank`)

This means the SES scoring engine cannot do prop-specific defense routing (points props vs points defense, threes props vs threes defense) and has zero bidirectional matchup scoring.

**Fix**:
- Update the SELECT query (line 674) to include all columns: `opp_points_rank, opp_threes_rank, off_points_rank, off_rebounds_rank, off_assists_rank, off_threes_rank, off_pace_rank`
- Expand the `defTeamMap` type (line 686) to store all fields
- Upgrade `calculateEnvironmentScoreV2` to match the bidirectional logic from `bot-generate-daily-parlays` -- route to prop-specific defense rank AND factor in team offensive rank
- Pass the new fields through to the scoring call (line 384)

---

### Gap 2: `bot-review-and-optimize` (AI Review Layer)

**Problem**: This engine queries `team_defense_rankings` but only selects:
- `team_abbreviation, team_name, overall_rank, points_allowed_rank, opp_rebounds_allowed_pg, opp_assists_allowed_pg, opp_rebounds_rank, opp_assists_rank`

It is **missing**:
- `opp_points_rank` and `opp_threes_rank`
- All 5 offensive columns

This means the AI review layer cannot assess offensive matchup context when reviewing/optimizing parlays.

**Fix**:
- Update the SELECT query (line 305) to include: `opp_points_rank, opp_threes_rank, off_points_rank, off_rebounds_rank, off_assists_rank, off_threes_rank, off_pace_rank`
- Update the `teamIntel` builder (lines 326-350) to pass the new fields into the review context

---

### Already Correct (No Changes Needed)

| Engine | Data Source | Status |
|--------|-----------|--------|
| `bot-generate-daily-parlays` | `team_defense_rankings` | All defense + offense columns selected, bidirectional matchup scoring implemented |
| `bot-matchup-defense-scanner` | `team_defense_rankings` | Uses all 4 defensive rank columns correctly |
| `detect-mispriced-lines` | `nba_opponent_defense_stats` | Properly updated by `fetch-team-defense-ratings` |
| `matchup-intelligence-analyzer` | `team_defensive_ratings` | Uses position-specific data, properly updated |
| `game-environment-validator` | `team_defensive_ratings` | Uses stat-type defense data, properly updated |
| `hedge-parlay-builder` | `team_defensive_ratings` | Full select, properly updated |
| `calculate-player-usage` | `nba_opponent_defense_stats` | Properly updated |

---

### Files Modified

1. **`supabase/functions/prop-engine-v2/index.ts`**
   - Expand SELECT query to include all defense + offense rank columns
   - Expand `defTeamMap` to store the new fields
   - Upgrade `calculateEnvironmentScoreV2` to add prop-specific defense routing and bidirectional matchup scoring (matching the logic in `bot-generate-daily-parlays`)
   - Pass offensive rank fields through to scoring calls

2. **`supabase/functions/bot-review-and-optimize/index.ts`**
   - Expand SELECT query to include `opp_points_rank, opp_threes_rank, off_points_rank, off_rebounds_rank, off_assists_rank, off_threes_rank, off_pace_rank`
   - Include these fields in the `teamIntel` context passed to the AI reviewer

