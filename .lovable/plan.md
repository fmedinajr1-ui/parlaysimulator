

# Make Today's Parlays Smarter: Per-Team Research + Scoring Overhaul

## What Went Wrong Yesterday

All 4 losses were NCAAB OVER totals that missed badly:
- UCLA vs Michigan: line 152.5, actual 142 (10 pts under)
- Texas A&M vs Vanderbilt: line 165.5, actual 151 (14 pts under)
- Northwestern vs Nebraska: line 145.5, actual 117 (28 pts under!)
- Clemson vs Duke: line 133.5, actual 121 (12 pts under)

**Root cause**: The bot picked OVERs blindly because:
1. Perplexity research returned empty results ("I cannot provide KenPom data") -- so zero research boosts were applied
2. The scoring function gives tempo bonuses to OVERs but doesn't validate against actual team scoring
3. Teams with missing KenPom data (like Florida Atlantic today) get a flat 55 score instead of being blocked
4. No per-team scoring trend analysis -- the bot doesn't check if teams are actually scoring enough to hit the over

## Today's Risk Assessment

8 parlays already generated, mostly OVERs again. Key risks:
- Florida Atlantic has NO KenPom data at all (null everything)
- Utah is ranked 160, Niagara 191 -- both borderline
- Iona is 135 -- below our new 200 gate but still risky
- No research intelligence backing any of these picks

## The Fix: 3 Changes

### Change 1: Enhanced AI Research Agent -- Team-Specific Queries

**File: `supabase/functions/ai-research-agent/index.ts`**

The current KenPom query asks Perplexity a generic question and Perplexity says "I don't have KenPom data." Instead, restructure the NCAAB research categories to ask questions Perplexity CAN actually answer:

1. Replace the `ncaab_kenpom_matchups` query with a more practical one that asks about today's specific team matchups, recent scoring trends, and pace of play -- things Perplexity can find from sports news rather than paywalled KenPom data
2. Add a new `ncaab_team_scoring_trends` category that asks: "For each NCAAB game today, what are the last 5 game scores for each team? What is each team's scoring average over their last 5 games? Which games are likely to go over/under based on recent scoring?" -- This gives the bot actual data to validate over/under picks
3. Make the sharp signals query more specific by including today's actual game slate (dynamically injected from the database)

### Change 2: Composite Score Hardening for NCAAB Totals

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

The `calculateNcaabTeamCompositeScore` function needs critical fixes:

1. **Block teams with no KenPom data from totals**: If either team has null `adj_offense`/`adj_defense`/`adj_tempo`, cap composite score at 40 (below selection threshold) instead of returning flat 55
2. **Add defensive efficiency check for OVERs**: If both teams have `adj_defense` below 70 (strong defense), penalize OVER by -12. Yesterday's misses all featured at least one strong defensive team
3. **Validate line against projected total**: Use `(homeOff + awayOff) * (avgTempo / 70)` as a crude projected total. If the OVER line exceeds this projection by 5+, penalize by -10 (the market is already pricing in an over, less value)
4. **Add UNDER bonus for defensive matchups**: When both teams are below 72 adj_offense (scoring less than average), boost UNDER by +8

### Change 3: Regenerate Today's Parlays with Fresh Research

**Execution steps (after deploying the code changes):**

1. Trigger `ai-research-agent` to pull fresh team-specific research with the improved queries
2. Delete today's 8 existing parlays (they were generated without research intelligence)
3. Run `bot-generate-daily-parlays` with `source: 'pipeline'` to regenerate with the new scoring and fresh research
4. Verify the new parlays have meaningful composite scores and aren't all OVERS

### Technical Details

**ai-research-agent changes:**

Replace the `ncaab_kenpom_matchups` query:
```
Old: "What are today's most interesting NCAA college basketball matchups based on KenPom efficiency ratings..."
New: "For each NCAA college basketball game today (February 15, 2026), provide: 1) Each team's last 5 game scores and results, 2) Average points scored and allowed per game over last 5, 3) Whether the game pace is fast or slow based on recent games, 4) Whether the total is likely to go OVER or UNDER based on recent scoring trends. Focus on: Indiana vs Illinois, South Florida vs Florida Atlantic, Utah vs Cincinnati, Bradley vs Southern Illinois, Iona vs Niagara."
```

Add new query for `ncaab_scoring_validation`:
```
"For these specific NCAAB games on February 15, 2026: [games list]. For each team, what were their exact scores in their last 3 games? What is the combined scoring average? Compare this to the posted total line. Flag any games where the total seems too high or too low based on recent performance."
```

**calculateNcaabTeamCompositeScore changes:**
```
// Block: either team has no data
if (!homeStats || !awayStats) {
  return { score: 40, breakdown: { no_data_penalty: -10 } };
}

// Projected total sanity check for OVERs
if (betType === 'total' && side === 'over') {
  const projectedTotal = (homeOff + awayOff) * (avgTempo / 70);
  const line = game.line || 0;
  if (line > projectedTotal + 5) {
    score -= 10;
    breakdown.line_above_projection = -10;
  }
}

// Defensive matchup penalty for OVERs
if (betType === 'total' && side === 'over' && homeDef < 70 && awayDef < 70) {
  score -= 12;
  breakdown.both_strong_defense = -12;
}

// Defensive matchup bonus for UNDERs
if (betType === 'total' && side === 'under' && homeOff < 72 && awayOff < 72) {
  score += 8;
  breakdown.low_scoring_teams = 8;
}
```

**Parlay regeneration:**
1. Delete today's parlays: `DELETE FROM bot_daily_parlays WHERE parlay_date = '2026-02-15'`
2. Run fresh research + generation pipeline

### Expected Impact

- Eliminates blind OVER bias by penalizing OVERs when defense is strong or line exceeds projection
- Research agent will actually return useful data (recent scores, trends) instead of "I can't find KenPom data"
- Teams with missing stats get blocked from parlays (score capped at 40)
- Today's regenerated parlays will have a mix of OVERs, UNDERs, and spreads based on actual matchup analysis

