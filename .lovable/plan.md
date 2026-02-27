

## Engine Hit Rate L10 Feed + Dynamic Offense/Defense Rank Scoring

### Problem
1. **No L10 feedback loop**: The generation engine does not query `bot_prop_type_performance` or `bot_strategies` hit rates before building parlays. Strategies like `mispriced_edge` generated 119 parlays at 13.4% because nothing throttled volume based on recent performance.
2. **Static defense usage**: The environment score uses defense ranks but doesn't weight them by offensive rank (opponent offense), meaning matchups aren't fully contextualized.
3. **No offensive rank data**: The system tracks defensive rankings but doesn't factor in offensive strength (e.g., a team that scores a lot vs one that doesn't).

### Changes

#### 1. L10 Hit Rate Feed into Generation Engine
**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

Add a new function `fetchStrategyHitRates()` that queries:
- `bot_strategies` for rolling 7-day win rates per strategy
- `bot_prop_type_performance` for prop-type hit rates and blocked/boosted flags

Then integrate into the parlay generation pipeline:
- **Volume throttling**: If a strategy's 7d win rate is below 25%, cap its parlay count to max 10 (instead of unlimited). If below 15%, cap to 5.
- **Prop type gating**: Skip any prop type where `is_blocked = true` in `bot_prop_type_performance`. Boost weight by +15 for `is_boosted = true` types.
- **Strategy weight multiplier**: Scale each strategy's allocation by its win rate relative to the average. A 57% strategy gets 1.5x allocation; a 13% strategy gets 0.3x.

This uses data already being refreshed by the `bot-update-engine-hit-rates` function.

#### 2. Offensive Rank Scoring in team_defense_rankings
**Database Migration**: Add offensive rank columns to `team_defense_rankings`:
- `off_points_rank` (1-30, 1 = highest scoring)
- `off_rebounds_rank`
- `off_assists_rank`
- `off_threes_rank`
- `off_pace_rank`

**File: `supabase/functions/fetch-team-defense-ratings/index.ts`**
- Extend the API fetch to also pull offensive stats (points scored per game, 3PT made, assists, rebounds)
- Rank teams 1-30 for each offensive category
- Store alongside existing defensive ranks

#### 3. Dynamic Offense/Defense Matchup Scoring
**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

Enhance `calculateEnvironmentScore()` to incorporate both sides of the matchup:

```text
Current:  defenseFactor = oppDefenseRank normalized (0-1)
Proposed: matchupFactor = (oppDefenseRank * 0.6 + teamOffenseRank * 0.4) normalized
```

- For OVER picks: weak opponent defense (high rank) + strong team offense (low rank) = high score
- For UNDER picks: strong opponent defense (low rank) + weak team offense (high rank) = high score
- This creates a true matchup advantage score rather than defense-only

Update the composite formula weights:
```text
Current:  pace(0.3) + defense(0.3) + rebAst(0.2) + blowout(-0.2)
Proposed: pace(0.25) + matchup(0.35) + rebAst(0.2) + blowout(-0.2)
```

#### 4. Prop-Specific Offensive Routing
Mirror the existing prop-specific defense routing for offense:
- Points props use `off_points_rank`
- Threes props use `off_threes_rank`
- Rebounds use `off_rebounds_rank`
- Assists use `off_assists_rank`
- Combo props use weighted averages

### Technical Details

**New database columns** (migration on `team_defense_rankings`):
- `off_points_rank INT`, `off_rebounds_rank INT`, `off_assists_rank INT`, `off_threes_rank INT`, `off_pace_rank INT`

**Modified files**:
1. `supabase/functions/bot-generate-daily-parlays/index.ts`
   - Add `fetchStrategyHitRates()` and `fetchPropTypePerformance()`
   - Add volume throttling logic using fetched hit rates
   - Update `calculateEnvironmentScore()` signature to accept offensive ranks
   - Update matchup scoring formula
2. `supabase/functions/fetch-team-defense-ratings/index.ts`
   - Fetch and compute offensive rankings
   - Store in new columns
3. Database migration for new columns

**Expected impact**: Strategies with poor recent hit rates get throttled automatically. The 119-parlay mispriced_edge flood on Feb 26 would have been capped to ~15 parlays. Matchup scoring becomes bidirectional (offense vs defense) instead of defense-only, improving pick quality for all prop types.

