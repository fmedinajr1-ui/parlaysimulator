

## Prop-Specific Defense Gates for ALL Prop Types

### The Problem

Right now, the parlay engine treats defense as one number -- `overall_rank` -- for ALL prop types. A team that's ranked #5 overall defensively gets the same penalty applied whether the pick is points, threes, rebounds, or assists. But in reality:

- Washington (ranked #30 overall) might be terrible against points but decent against assists
- Cleveland (ranked #2 overall) might lock down shooters but give up boards
- Indiana (ranked #18 overall) might play fast and allow tons of assists

The `team_defense_rankings` table already has `opp_rebounds_rank` and `opp_assists_rank`, but is missing `opp_points_rank` and `opp_threes_rank`. And the `team_zone_defense` table has 3PT zone data that's never used in the parlay engine. Meanwhile, the `nba_defense_codes` table has `vs_points_code`, `vs_rebounds_code`, `vs_assists_code` but they're all calculated from the SAME `overall_rank` number -- making them useless.

### The Fix: 3 Layers

**Layer 1: Add missing defense columns to `team_defense_rankings`**

Add `opp_points_rank` and `opp_threes_rank` columns to the existing table and seed them with real differentiated rankings (not just copies of `overall_rank`). This gives every team a per-stat defensive identity:

| Column | What it measures | Example |
|---|---|---|
| `overall_rank` | General defense (already exists) | CLE = 2 |
| `opp_points_rank` | Points allowed per game rank (NEW) | CLE = 3 |
| `opp_threes_rank` | 3PM allowed per game rank (NEW) | CLE = 8 |
| `opp_rebounds_rank` | Rebounds allowed rank (already exists) | CLE = 12 |
| `opp_assists_rank` | Assists allowed rank (already exists) | CLE = 5 |

**Layer 2: Upgrade the Environment Score engine to use prop-specific defense**

Change `calculateEnvironmentScore` in `bot-generate-daily-parlays` so the `defenseFactor` uses the RIGHT rank for each prop type:

```text
points / pts  -->  opp_points_rank   (falls back to overall_rank)
threes / 3pm  -->  opp_threes_rank   (falls back to overall_rank)
rebounds / reb -->  opp_rebounds_rank  (already wired)
assists / ast  -->  opp_assists_rank  (already wired)
combos (pra, pr, pa, ra)  -->  weighted average of relevant ranks
```

This means a "points OVER" pick against Washington (bad points defense, rank 28) gets boosted, while the same pick against Cleveland (elite points defense, rank 3) gets penalized -- even if their overall ranks are different from their per-stat ranks.

**Layer 3: Add prop-specific defense hard-gates + exposure cap**

For each prop type entering the execution tier:
- **Hard-block OVER picks** against top-5 defenses in that specific stat category
- **Penalize (-15)** OVER picks against top-10 defenses in that stat category
- **Boost (+10)** OVER picks against bottom-10 defenses (rank 21-30) in that stat category
- **70% L10 floor** for threes props in execution tier (the specific fix from yesterday's analysis)
- **Global exposure cap**: max 5 parlays per player+prop combination across all tiers

### What This Means in Practice

Yesterday's example: if Harrison Barnes had a threes OVER pick and the opponent had a strong 3PT defense (rank 6), the system would:
1. Use `opp_threes_rank = 6` instead of generic `overall_rank`
2. Apply -15 composite penalty (top-10 threes defense)
3. Check his L10 hit rate (60%) -- below 70% floor, blocked from execution tier
4. Even if he made it to exploration, cap him at 5 parlays max

Meanwhile, a rebounds pick against the same team might get BOOSTED if that team is weak at defending the boards (e.g., `opp_rebounds_rank = 25`).

---

### Technical Details

**Database Migration: Add 2 columns + seed data**

```sql
ALTER TABLE team_defense_rankings
  ADD COLUMN IF NOT EXISTS opp_points_rank INTEGER,
  ADD COLUMN IF NOT EXISTS opp_threes_rank INTEGER;
```

Seed with differentiated per-stat rankings for all 30 NBA teams based on 2024-25 season data. These will differ from `overall_rank` to reflect each team's actual stat-specific defensive strengths and weaknesses.

Also update `nba_defense_codes` to use the correct per-stat ranks instead of copying `overall_rank` for all three codes.

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

1. **Expand the defense data fetch** (~line 3291): Add `opp_points_rank, opp_threes_rank` to the SELECT query and store them in `defenseDetailMap`

2. **Upgrade `calculateEnvironmentScore`** (~line 86): Add `oppPointsRank` and `oppThreesRank` parameters. Route the `defenseFactor` calculation through a prop-type switch:
   - `points` -> use `oppPointsRank`
   - `threes` -> use `oppThreesRank`  
   - `rebounds` -> use `oppRebRank` (already exists)
   - `assists` -> use `oppAstRank` (already exists)
   - combos -> weighted average of relevant stat ranks

3. **Add prop-specific defense hard-gates** (after environment enrichment ~line 4435): For execution tier candidates, check the prop-specific defense rank and apply hard-blocks (top-5) or penalties (top-10) or boosts (bottom-10)

4. **Add threes L10 floor** (in execution tier filtering): Require 70% L10 hit rate for threes props

5. **Add global slate exposure cap**: Create a `globalSlateUsage` map tracking `playerName|propType` across all tiers, capped at 5

**File: `supabase/functions/bot-force-fresh-parlays/index.ts`**

Add the same global exposure cap logic (max 5 per player+prop).

### Summary

| Change | What it does |
|---|---|
| Add `opp_points_rank` + `opp_threes_rank` columns | Per-stat defensive identity for every team |
| Prop-specific defense routing | Points picks use points defense, threes use threes defense, etc. |
| Hard-block OVER vs top-5 stat defense | No execution OVER picks into elite stat-specific defenses |
| Penalty/boost for top-10/bottom-10 | Score adjustments based on matchup quality per stat |
| 70% L10 floor for threes execution | Only proven shooters in best-bet threes picks |
| Max 5 parlays per player+prop | One bad beat can never cascade across 10-17 parlays |

