

# Fix Settlement + Verify New Intelligence Is Active

## Two Distinct Problems

### Problem 1: Feb 16 Parlays Won't Settle

**Root cause**: The Feb 16 parlays were generated with the OLD leg format. They use `player_name: "Team A @ Team B"` with `prop_type: "total"` and `line_source: "whale_signal"` but have NO `home_team`/`away_team` fields. The `bot-settle-and-learn` function checks `isTeamLeg()` which requires those fields, so every leg returns `no_data` and stays pending forever.

Additionally, `bot-settle-and-learn` has no recent logs at all -- it appears to not be executing despite its cron schedule (11, 17, 23 UTC).

**Fix**: Update `bot-settle-and-learn` to handle the old-format legs:
- Parse `player_name` like `"Louisiana Ragin' Cajuns @ Old Dominion Monarchs"` to extract home/away teams
- Treat legs with `line_source: "whale_signal"` and `category: "TOTAL"/"SPREAD"` as team legs even without explicit `home_team`/`away_team`
- Then trigger a manual settlement run for Feb 16

### Problem 2: New Intelligence Layers Are NOT Active in Today's Picks

Evidence from the database:

| Layer | Status | Evidence |
|-------|--------|----------|
| KenPom rankings | Broken | Auburn ranked #33 (should be ~1), Saint Mary's AdjD=52 (should be ~96) |
| ATS records | Empty | 0 of 362 teams have data |
| O/U records | Empty | 0 of 362 teams have data |
| Last-5 PPG | Empty | All NULL |
| Last-5 OPPG | Empty | All NULL |
| OVER blocking | NOT working | Purdue/Michigan OVER is the #1 scored pick at composite 95 |
| Referee adjustments | Missing | No `referee_adjustment` in any score breakdown |
| Fatigue penalties | Missing | No `fatigue_penalty` in any score breakdown |
| Altitude impact | Missing | No `altitude_impact` in any score breakdown |

The scoring engine is still running the OLD formula (base + tempo + line_value + sharp_confirmation + rank bonuses based on broken rankings).

**Why**: The `data-pipeline-orchestrator` hasn't run today (no entries in `cron_job_history`). The new functions (`ncaab-kenpom-scraper`, `ncaab-referee-scraper`, `ncaab-fatigue-calculator`) were added to the orchestrator code but the orchestrator itself has no cron trigger -- it was being called manually. Meanwhile, the scoring engine updates may not have been deployed.

## Fix Plan

### Step 1: Fix `bot-settle-and-learn` Old-Format Leg Parsing
- Add a fallback parser that extracts teams from `player_name` field when `home_team`/`away_team` are missing
- Pattern: `"Away Team @ Home Team"` or `"Away Team vs Home Team"`
- Once parsed, route through the existing ESPN settlement paths

### Step 2: Verify and Fix Scoring Engine Deployment
- Check that `team-bets-scoring-engine` has the KenPom validation (reject AdjD < 80), referee lookups, fatigue lookups, cold/hot team logic, and OVER blocking
- The score breakdowns show none of these fields, suggesting the updated version may not be deployed

### Step 3: Fix KenPom Scraper Parser
- Current data shows AdjD values of 52, 63, 72 for teams -- all below the 80 minimum that should be validated
- The scraper parser is still reading wrong columns from the BartTorvik/KenPom markdown
- Need to add robust column detection that validates AdjD is in the 85-115 range for most teams

### Step 4: Populate ATS/OU and L5 Data
- The `ncaab-team-stats-fetcher` was updated to derive ATS/OU from settled bets but clearly hasn't run successfully
- Need to verify the function works and trigger it

### Step 5: Wire Up Pipeline Orchestrator Cron
- Add a cron job for the full pipeline orchestrator (currently has none in the cron table)
- Without this, none of the Phase 1 data collection or Phase 2 analysis runs automatically

### Step 6: Re-run Full Pipeline for Today
- After all fixes are deployed, trigger a full pipeline run to:
  - Settle Feb 16 parlays
  - Re-scrape KenPom with fixed parser
  - Populate ATS/OU and L5 data
  - Calculate fatigue and referee data for today
  - Re-score all Feb 17 NCAAB bets with all intelligence layers active
  - Regenerate parlays with correct data

## Files Changed

1. **MODIFY** `supabase/functions/bot-settle-and-learn/index.ts` -- Add old-format leg parser for `player_name` field
2. **MODIFY** `supabase/functions/ncaab-kenpom-scraper/index.ts` -- Fix column detection to validate AdjD ranges (85-115)
3. **MODIFY** `supabase/functions/team-bets-scoring-engine/index.ts` -- Verify all new modules (referee, fatigue, L5, OVER block) are present and functional
4. **MODIFY** `supabase/functions/ncaab-team-stats-fetcher/index.ts` -- Debug and fix ATS/OU derivation + L5 data population
5. **DATABASE** -- Add pipeline orchestrator cron job for automated daily runs

## Expected Outcome
- Feb 16 parlays settled with correct outcomes
- Feb 17 picks regenerated with all 3 intelligence layers active (KenPom, referees, fatigue)
- NCAAB OVERs properly blocked
- ATS/OU trend bonuses active in scoring
- Pipeline runs automatically going forward
