

## Plan: Matchup-First Pick Prioritization + Generate Today's Lottery

Two tasks: (1) Add matchup-first intelligence to both parlay builders so picks are prioritized by exploiting opponent defensive weaknesses, and (2) trigger today's lottery ticket generation.

---

### Task 1: Matchup-First Pick Prioritization

**The Core Idea:** Instead of scoring picks generically then adjusting for defense, actively hunt for matchups where a player's strength directly exploits the opponent's specific statistical weakness.

---

#### File 1: `supabase/functions/sharp-parlay-builder/index.ts`

Currently has **zero defense awareness** — candidates are scored purely on median edge, archetype, and category. Defense data isn't loaded at all.

**Changes:**

1. **Load defense rankings** (after `loadProjections` around line 689):
   - Query `team_defense_rankings` for `team_abbreviation, team_name, opp_points_rank, opp_rebounds_rank, opp_assists_rank, opp_threes_rank` where `is_current = true`
   - Build a `defenseRankMap: Map<string, { ptsRank, rebRank, astRank, threesRank }>`
   - Also load `bdl_player_cache` team mappings (already done via `loadPlayerTeams`)

2. **Load today's game matchups** (after defense data):
   - Query `upcoming_games_cache` or `game_bets` to get home/away team pairings for today
   - Build `opponentMap: Map<teamAbbrev, opponentAbbrev>` so we know who each team faces

3. **Add matchup alignment scoring** (in the candidate scoring loop around line 950-992):
   - For each candidate, look up their team → opponent → opponent's defense rank for the candidate's specific stat
   - If opponent defense rank >= 20 (weak) in the prop's stat category AND player's L10 hit rate >= 65%: **+0.15 confidence boost** (matchup aligned)
   - If opponent defense rank >= 25 (very weak): **+0.20 confidence boost**
   - If opponent defense rank <= 8 (strong defense): **-0.10 confidence penalty**
   - Tag `matchupAligned: true` on the candidate for logging

4. **Prefer matchup-aligned picks in buildParlay** (around line 1200-1230):
   - In the sort order, add matchup alignment as a factor between stat priority and edge (matchup-aligned picks sort higher)

---

#### File 2: `supabase/functions/bot-generate-daily-parlays/index.ts`

Already has full defense data loaded (`defenseDetailMap`, `defenseMap`), but doesn't use it to proactively **boost** player picks based on prop-specific matchups. The defense data currently only feeds into team-level scoring and the God Mode hard-block.

**Changes:**

1. **Build Matchup Opportunity Map** (after line 4196 where `teamGameContextMap` is built, ~50 lines):
   - For each game today (from `envMap`), check both teams' defense detail:
     - If Team A allows lots of rebounds (rank >= 20), tag Team B's players with "rebounds matchup opportunity"
     - Same for points, assists, threes
   - Build `matchupOpportunityMap: Map<teamAbbrev, { stat: string, oppDefRank: number }[]>`

2. **Apply Matchup Alignment Boost to enriched sweet spots** (after line 4383 context adjustments, ~30 lines):
   - For each enriched pick, resolve their team abbreviation
   - Look up matchup opportunities for that team
   - If pick's prop type aligns with an opponent weakness:
     - Rank >= 20: **+12 compositeScore**
     - Rank >= 25: **+18 compositeScore** (prime matchup)
     - Rank >= 28: **+22 compositeScore** (elite matchup exploitation)
   - Tag picks with `matchupAligned: true` and log the boost

3. **Require minimum 2 matchup-aligned legs in execution tier** (in the parlay assembly loop):
   - After assembling an execution-tier parlay, check if at least 2 legs are `matchupAligned`
   - If not, try to swap in matchup-aligned picks from the pool
   - If still can't meet minimum, allow the parlay but log a warning

4. **Also apply the matchup defense scan from research** (already partially implemented via `fetchMatchupDefenseScan`):
   - The existing `matchupDefenseScan` returns prime/favorable/avoid tags but the boost is only +12 for prime
   - Increase prime boost to +18 to match the new matchup-first philosophy

---

### Task 2: Generate Today's Lottery Tickets

Trigger the `nba-mega-parlay-scanner` edge function to generate today's Standard, High Roller, and Mega Jackpot tickets. This will run with the new DD rules (no same-game DD, defense gate for DD picks) already deployed.

---

### Summary of Changes

| File | What |
|------|------|
| `sharp-parlay-builder/index.ts` | Load defense rankings + game matchups, add matchup-aware scoring (+0.15/+0.20 boost for weak defense, -0.10 penalty for strong), prefer matchup-aligned picks in sort |
| `bot-generate-daily-parlays/index.ts` | Build matchup opportunity map from defense data, add +12/+18/+22 compositeScore boost for prop-stat-specific opponent weaknesses, require 2+ matchup-aligned legs in execution tier |
| Lottery generation | Invoke `nba-mega-parlay-scanner` to create today's tickets |

Both edge functions redeploy automatically. The lottery scanner runs after deployment.

