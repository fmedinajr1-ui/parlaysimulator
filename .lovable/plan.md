
# Enhance NCAAB Team Prop Accuracy

## The Problem

Right now NCAAB team props are essentially random picks. Here is what the data shows:

- **519 NCAAB game bets** in the system, but **zero have been settled** (no outcomes tracked)
- **0 rows** in the NCAAB team stats table (KenPom efficiency/tempo data is missing)
- Every NCAAB team pick gets a **flat composite score of 55** because there is no college-specific intelligence
- Winning parlays with NCAAB legs show `no_data` for those legs, meaning they cannot be verified

Meanwhile, winning bot strategies like `cross_sport` and `team_all` already include NCAAB legs -- they just lack the data to score them properly.

## The Fix: 3 Components

### 1. Populate NCAAB Team Intelligence (KenPom-Style Data)

Create a new backend function `ncaab-team-stats-fetcher` that scrapes or fetches college basketball team efficiency data and populates the existing `ncaab_team_stats` table with:

- **Adjusted Offense/Defense** ratings (the most predictive college basketball metrics)
- **Adjusted Tempo** (critical for totals -- college game pace varies wildly, from 60 to 75+ possessions)
- **Conference**, **Home/Away records**, **ATS record**, **Over/Under record**
- **KenPom Rank** (overall team quality tier)

This data feeds directly into the composite scoring engine.

### 2. NCAAB-Aware Composite Scoring

Upgrade `calculateTeamCompositeScore` in the parlay generator to use NCAAB-specific logic when the sport is college basketball:

- **KenPom efficiency differential** for spreads and moneylines (adj_offense - adj_defense gap between teams)
- **Tempo-based total scoring** using college-specific pace thresholds (college games average ~67 possessions vs NBA's ~100)
- **Conference matchup context** (conference games are tighter, non-conference early season is more volatile)
- **ATS/O-U record weighting** from historical team performance
- **Rank-based tier filtering** (Top 50 KenPom teams are far more predictable than 200+)

### 3. NCAAB Settlement via ESPN Scores

Upgrade the settlement function to resolve NCAAB team legs using ESPN scoreboard data directly (instead of summing individual player box scores, which is unreliable for 350+ college teams):

- Fetch final scores from the ESPN NCAAB scoreboard API (already used by `ncaab-data-ingestion`)
- Match games by team name fuzzy matching
- Settle spreads, moneylines, and totals against actual final scores
- Back-settle the 519 existing unsettled NCAAB game_bets to establish a historical accuracy baseline

### 4. NCAAB-Specific Bot Profiles

Add dedicated NCAAB parlay profiles to the bot:

- `ncaab_ml_lock` -- 3-leg moneyline parlays using only KenPom Top 100 teams with efficiency edges
- `ncaab_totals` -- 3-leg totals parlays using tempo differentials (the most predictable NCAAB bet type)
- Require minimum composite score of 62+ (vs current flat 55)

## Technical Details

### New Backend Function: `ncaab-team-stats-fetcher`
- Fetches team efficiency data from public college basketball statistics APIs
- Populates `ncaab_team_stats` table (already exists with correct schema)
- Runs daily on cron alongside existing data pipeline

### Modified: `bot-generate-daily-parlays/index.ts`
- Add `ncaabTeamStatsMap` data source alongside existing pace/defense maps
- Branch `calculateTeamCompositeScore` for NCAAB sport:
  - Use KenPom efficiency gap instead of NBA defense rankings
  - Use college tempo thresholds (65-75 range vs NBA 95-105)
  - Weight ATS/O-U records from `ncaab_team_stats`
  - Add rank-tier filter (reject teams ranked 200+)
- Add 2 new execution profiles: `ncaab_ml_lock`, `ncaab_totals`

### Modified: `bot-settle-and-learn/index.ts`
- For NCAAB team legs, fetch ESPN scoreboard directly instead of summing player logs
- Use the same ESPN API endpoint already configured in `sync-live-scores`
- Fuzzy match team names from leg data to ESPN event data

### New Database Migration
- Add `sport` column to `game_bets` outcome tracking (for filtered accuracy queries)
- Create `ncaab_team_accuracy_metrics` view for NCAAB-specific win rate tracking

## Expected Impact

With proper KenPom data feeding the scoring engine:
- **Totals** become highly predictable (tempo is the strongest predictor in college basketball)
- **Spreads** with large efficiency gaps (10+ point KenPom differential) hit at 60%+
- **Moneylines** for Top 50 teams at home hit at very high rates
- Settlement data creates a feedback loop for continuous improvement

## Files to Create/Modify

1. **Create** `supabase/functions/ncaab-team-stats-fetcher/index.ts` -- New data ingestion function
2. **Modify** `supabase/functions/bot-generate-daily-parlays/index.ts` -- NCAAB scoring + profiles
3. **Modify** `supabase/functions/bot-settle-and-learn/index.ts` -- ESPN-based NCAAB settlement
4. **Database migration** -- accuracy tracking support
