

## Matchup Defense Scanner — Pre-Pipeline Intelligence Layer

### What This Does

Right now, the pipeline works backwards: it starts with ALL player props, then applies defensive filters as penalties/boosts after the fact. The bot should instead work like a smart bettor:

1. **First**: Look at today's games and identify which teams have weak defenses in specific stat categories
2. **Second**: Flag which prop types are "in play" for each game based on defensive matchups
3. **Third**: Only THEN run the prop pipeline (L10, environment, mispricing) for those flagged opportunities

This creates a new edge function called `bot-matchup-defense-scanner` that runs in Phase 2 (Analysis) BEFORE `detect-mispriced-lines` and `category-props-analyzer`. It writes a structured "matchup opportunity map" to `bot_research_findings` that the parlay generator reads and uses to prioritize picks.

### How It Works

```text
Today's Games (game_bets)
         |
         v
For each game, look up BOTH teams' per-stat defense ranks
(opp_points_rank, opp_threes_rank, opp_rebounds_rank, opp_assists_rank)
         |
         v
Identify "soft spots" — stat categories where opponent ranks 18-30
         |
         v
Output: Matchup Opportunity Map
  Game: LAL vs WAS
    WAS allows: Points (rank 28), Assists (rank 25), Threes (rank 22)
    LAL allows: Rebounds (rank 26)
    --> LAL players: target Points, Assists, Threes OVER
    --> WAS players: target Rebounds OVER
         |
         v
Write to bot_research_findings as "matchup_defense_scan"
         |
         v
Generator reads this and applies priority boosts to aligned picks
```

### The Matchup Opportunity Map

For each game, the scanner produces:

| Field | Description |
|---|---|
| `home_team` / `away_team` | Teams playing |
| `home_soft_spots` | Stat categories where home team defense is weak (rank 18+) |
| `away_soft_spots` | Stat categories where away team defense is weak (rank 18+) |
| `home_elite_defense` | Stat categories where home team defense is elite (rank 1-5) |
| `away_elite_defense` | Stat categories where away team defense is elite (rank 1-5) |
| `recommended_props` | Array of `{ team, prop_type, side, defense_rank, priority }` |

Priority levels:
- **"prime"** — opponent rank 25-30 in that stat (massive soft spot)
- **"favorable"** — opponent rank 18-24 (good matchup)
- **"avoid"** — opponent rank 1-5 (elite defense, hard-block OVER)

### Generator Integration

The parlay generator will read the matchup scan findings and apply:
- **+12 composite boost** for picks that align with "prime" matchup opportunities
- **+6 composite boost** for "favorable" matchups
- **-20 penalty + hard-block** for picks going OVER against "avoid" matchups (reinforces existing defense gates)
- Picks with NO matchup data get no adjustment (neutral)

This means the bot will naturally gravitate toward props where the defensive matchup is favorable BEFORE even checking L10 hit rates or mispricing.

---

### Technical Details

**New File: `supabase/functions/bot-matchup-defense-scanner/index.ts`**

A new edge function that:
1. Fetches today's NBA games from `game_bets` (filtered to basketball_nba)
2. Loads `team_defense_rankings` with all per-stat ranks (`opp_points_rank`, `opp_threes_rank`, `opp_rebounds_rank`, `opp_assists_rank`)
3. For each game, cross-references both teams' defensive weaknesses
4. Builds a structured matchup opportunity map with priorities
5. Writes the result to `bot_research_findings` with category `matchup_defense_scan`

Key logic:
```text
For each game:
  homeDefense = team_defense_rankings[home_team]
  awayDefense = team_defense_rankings[away_team]

  // Away team's players attack home defense
  for stat in [points, threes, rebounds, assists]:
    if homeDefense[stat_rank] >= 25: prime opportunity for away players
    if homeDefense[stat_rank] >= 18: favorable opportunity for away players
    if homeDefense[stat_rank] <= 5: avoid for away players OVER

  // Home team's players attack away defense (same logic, reversed)
```

**File: `supabase/functions/data-pipeline-orchestrator/index.ts`**

Add `bot-matchup-defense-scanner` to Phase 2 (Analysis), running BEFORE `category-props-analyzer` and `detect-mispriced-lines`. This ensures the matchup map is available before any prop analysis begins.

Insert at line 120, before the existing analysis functions:
```text
await runFunction('bot-matchup-defense-scanner', {});
```

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

After loading `bot_research_findings`, parse any entry with category `matchup_defense_scan` from today. Build a `matchupOpportunityMap: Map<string, { prop_type, priority }>` keyed by `teamAbbrev|propType`.

In the enrichment loop (where defense gates are already applied, ~line 4440), add a check:
- Look up `matchupOpportunityMap` for the pick's team + prop type
- If priority is "prime": +12 composite boost
- If priority is "favorable": +6 composite boost  
- Log matchup alignment for diagnostics

This stacks ON TOP of the existing defense gates (which handle penalties/blocks for elite defenses), giving a double benefit: bad matchups get penalized AND good matchups get boosted before assembly.

### Summary

| Change | What it does |
|---|---|
| New `bot-matchup-defense-scanner` function | Scans today's games, identifies per-stat defensive soft spots for each team |
| Pipeline orchestrator update | Runs scanner in Phase 2 before prop analysis |
| Generator matchup boost | +12/+6 composite boost for picks aligned with favorable defensive matchups |
| Structured output | Writes matchup map to `bot_research_findings` for full audit trail |

