
# Fix Today's NCAAB Picks: Duplicates, Data Quality, and PAE Integration

## Problems Identified

1. **Duplicate Parlays**: The mini-parlay generator creates 51 parlays from a very small pool of ~6 games, producing near-identical combinations (e.g., "SMU ML + Xavier Spread" appears 5+ times across tiers with only bet_type varying). The fingerprint dedup treats ML vs Spread as different, but to the user they look like duplicates.

2. **Bad Team Rankings (SMU = #193)**: SMU has null PPG/OPPG because ESPN didn't return their stats. The PAE formula falls back to estimated values, producing adj_offense = adj_defense = 114.6 — ranking them 193rd when they should be ~40th. This means the composite scoring is using garbage data.

3. **ATS/OU Records All Null**: The stats fetcher derived 0 ATS/OU records because there are no settled NCAAB `game_bets` in the database. This means the ATS/OU weighting in the composite scorer is completely inactive.

4. **Settlement Fix is Permanent**: The `groups=50` fix to the ESPN scoreboard URL is already in the deployed code and will work going forward.

## Plan

### Step 1: Fix the stats-fetcher to not lose ESPN data for teams it can't enrich

The `ncaab-team-stats-fetcher` only enriches ~200 of 362 teams. Teams it misses (like SMU) get null PPG/OPPG, which breaks the PAE formula downstream. Fix: when a team isn't enriched, skip it in the upsert rather than inserting it with nulls.

### Step 2: Fix PAE formula to handle missing PPG/OPPG more intelligently

Currently when ppg is null, the PAE formula estimates from conference SOS alone, producing nearly identical offense/defense values. Improve the fallback: if a team exists in the DB with existing adj_offense/adj_defense from a previous run, preserve those values instead of overwriting with bad estimates.

### Step 3: Fix mini-parlay deduplication to prevent near-duplicates

The mini-parlay fingerprint uses `home_team_bet_type_side`, meaning ML and Spread for the same team create different fingerprints. Add a "game-level" dedup: limit each game to appearing in at most 3 mini-parlays total, and add a secondary fingerprint that ignores bet_type to catch same-matchup duplicates.

### Step 4: Clear and regenerate today's parlays

After deploying fixes, delete all Feb 17 parlays and re-run the generator with the corrected data.

## Technical Details

### stats-fetcher changes (`ncaab-team-stats-fetcher/index.ts`)
- In the upsert chunk (line ~321), only include teams that were actually enriched (have non-null ppg). Non-enriched teams should not overwrite existing data with nulls.

### PAE formula changes (`ncaab-kenpom-scraper/index.ts`)
- Before the PAE calculation, fetch existing `adj_offense`/`adj_defense` from the database for teams with null PPG
- If a team has no ESPN data AND no prior PAE data, skip it entirely rather than generating bad estimates

### Mini-parlay dedup (`bot-generate-daily-parlays/index.ts`)
- Add a `gameUsageCount` map tracking how many mini-parlays each game appears in
- Cap at 3 appearances per game across all mini-parlays
- Add a secondary "matchup fingerprint" (just team names, ignoring bet_type) with a cap of 2 per unique team pair

### Regeneration
- Delete all `bot_daily_parlays` where `parlay_date = '2026-02-17'`
- Re-run `ncaab-team-stats-fetcher` then `ncaab-kenpom-scraper` to refresh data
- Re-run `bot-generate-daily-parlays` for today
