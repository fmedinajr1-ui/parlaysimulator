
# NCAAB Accuracy Emergency Fix -- Focus Until Thursday

## Current Problems (Critical)

1. **KenPom scraper is broken** -- Top 28 teams have NO efficiency data (Auburn, Duke, Florida, Houston all NULL). The regex parser grabs wrong columns (AdjD=52 for Saint Mary's, should be ~96). Rankings are still PPG-derived for most teams (Saint Louis #1 instead of Auburn).

2. **ATS and O/U records are ALL NULL** -- 0 out of 362 teams. The scoring engine's +8 ATS bonus and +6 O/U trend logic is completely inactive.

3. **Fatigue/referee data didn't run for today** -- Only Feb 16 data exists. Today (Feb 17) has 0 referee assignments and 0 fatigue scores.

4. **28 unscored games today** -- 88/116 NCAAB bets scored, 28 missing composite scores.

## What's Working
- NCAAB OVERs are properly hard-blocked in the generator
- NCAAB spreads have been winning (2 parlays hit on Feb 13)
- Whale signal strategies winning (2 for 2 on Feb 15)
- Fatigue calculator logic and locations are solid, just needs to run on correct dates

---

## Fix 1: Rebuild KenPom Scraper Parser (Critical)

**File**: `supabase/functions/ncaab-kenpom-scraper/index.ts`

The current parser fails because:
- KenPom's markdown includes `[Team Name](url)` links that break the regex
- The `stripLinks` helper was added but the fallback parser still grabs wrong columns
- Top teams (ranks 1-28) don't match any regex pattern at all

**Fix approach**:
- Scrape kenpom.com with `formats: ['extract']` using a structured schema to extract the table data reliably instead of regex parsing markdown
- If extract fails, fall back to scraping barttorvik.com/rankings.php which has a cleaner table format
- Log 5-10 raw lines from the markdown for the top teams so we can debug the exact format
- Add robust column detection: identify which column indices contain AdjO (should be 95-130 range), AdjD (should be 85-115 range), and AdjT (should be 60-75 range) by checking value ranges instead of hardcoding positions
- Add validation: reject any AdjD < 80 or AdjD > 120 as clearly wrong parsing

## Fix 2: Derive ATS and O/U Records from Settled Game Data

**File**: `supabase/functions/ncaab-team-stats-fetcher/index.ts` (modify)

Instead of scraping ATS records (which ESPN doesn't publish cleanly), derive them from our own settled `game_bets` data:
- Query all settled NCAAB spread bets from the last 30 days
- For each team, count wins/losses against the spread
- Write the derived ATS record (e.g., "12-8") back to `ncaab_team_stats.ats_record`
- Same approach for O/U records from settled totals
- This uses data we already have -- no new API calls needed

## Fix 3: Add Last-5-Games Columns + Populate

**Database**: Add `last_5_ppg`, `last_5_oppg`, `streak`, `last_5_ats` columns to `ncaab_team_stats`

**File**: `supabase/functions/ncaab-team-stats-fetcher/index.ts` (modify)

- Query the last 5 settled games per team from `game_bets` to calculate recent scoring averages
- Write `last_5_ppg` and `last_5_oppg` to the team stats table
- Scoring engine uses blended formula: `effectivePPG = (seasonPPG * 0.4) + (last5PPG * 0.6)`

## Fix 4: Scoring Engine -- Use Recent Data + Fix Projections

**File**: `supabase/functions/team-bets-scoring-engine/index.ts`

- When KenPom AdjD is clearly wrong (< 80 or > 120), fall back to ESPN-derived values instead of using garbage data
- Use `last_5_ppg`/`last_5_oppg` blended with season averages for totals projections
- Add "cold team" penalty: if recent scoring is 10%+ below season average, penalize OVERs by -10
- Add "hot team" bonus: if recent scoring is 10%+ above season average, boost OVERs by +5

## Fix 5: Expand NCAAB Name Map for Void Prevention

**File**: `supabase/functions/team-bets-scoring-engine/index.ts`

- Add 30+ additional team name variations (cross-reference recent void legs to find which names are failing)
- Focus on small-conference teams that show up in today's slate (Northwestern St, Maryland-Eastern Shore, UT Rio Grande Valley, etc.)

## Fix 6: Re-run Pipeline for Today

After deploying fixes, trigger the pipeline with `mode: 'full'` to:
- Re-scrape KenPom with fixed parser
- Calculate fatigue for today's Feb 17 games
- Re-score all 116 NCAAB bets with fresh data
- Generate new parlays with correct intelligence

---

## Files Changed

1. **MODIFY** `supabase/functions/ncaab-kenpom-scraper/index.ts` -- Fix parser to handle markdown links, validate AdjD ranges, add structured extraction fallback
2. **MODIFY** `supabase/functions/ncaab-team-stats-fetcher/index.ts` -- Add ATS/OU derivation from settled bets, L5 scoring trends
3. **MODIFY** `supabase/functions/team-bets-scoring-engine/index.ts` -- Validate KenPom values, use L5 data, expand name map, add cold/hot team logic
4. **DATABASE** -- Add `last_5_ppg`, `last_5_oppg`, `streak`, `last_5_ats` columns to `ncaab_team_stats`

## Expected Impact

| Issue | Before | After |
|-------|--------|-------|
| KenPom coverage | 0 of top 28 teams | All 362 teams with validated efficiency |
| ATS records | 0/362 teams | Derived from 30 days of settled bets |
| Projected totals | Using raw PPG/OPPG | KenPom efficiency + L5 recent trends |
| Void rate | 28% | Target under 10% with expanded name map |
| Today's scoring | 76% scored | 100% with name map fixes |
