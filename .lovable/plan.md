

# NCAAB Accuracy Blitz: KenPom + Referees + Venue Intelligence

## Overview
Three new data layers to dramatically improve NCAAB accuracy before NBA returns Thursday. Each addresses a blind spot that's currently costing wins.

## Problem Context
The current "KenPom rankings" are just PPG minus OPPG sorted -- Saint Louis Billikens is ranked #1 and Miami (OH) is #6, which is wildly wrong. Real KenPom has teams like Auburn, Duke, Florida, and Houston at the top. This means the scoring engine's rank-based bonuses (+10 for Top 25, +7 for Top 50) are being applied to the wrong teams entirely.

---

## Upgrade 1: Real KenPom Rankings via Firecrawl Scraping

**What**: Scrape actual KenPom efficiency data from kenpom.com using the existing Firecrawl connector.

**Why**: The current ranking system (PPG - OPPG) has Miami (OH) at #6 and Saint Louis at #1. Real KenPom adjusts for strength of schedule, pace, and opponent quality. This single fix will improve every NCAAB spread, moneyline, and total projection.

**How**:
- New edge function `ncaab-kenpom-scraper` uses Firecrawl to scrape kenpom.com/index.php
- Extracts: team name, rank, adjusted offensive efficiency (AdjO), adjusted defensive efficiency (AdjD), adjusted tempo (AdjT), strength of schedule, and luck factor
- Maps scraped team names to existing `ncaab_team_stats` entries using fuzzy matching
- Overwrites `kenpom_rank`, `adj_offense`, `adj_defense`, `adj_tempo` with real values
- Adds new columns: `sos_rank` (strength of schedule), `luck_factor`, `kenpom_adj_o` and `kenpom_adj_d` (per-100-possession efficiency, distinct from raw PPG)
- Runs in Phase 1 of the pipeline, before the scoring engine

**Database changes**:
- Add columns to `ncaab_team_stats`: `kenpom_adj_o` (numeric), `kenpom_adj_d` (numeric), `sos_rank` (integer), `luck_factor` (numeric), `kenpom_source` (text, default 'scraped')

**Scoring engine update**:
- Use `kenpom_adj_o` and `kenpom_adj_d` (per-100-possessions efficiency) instead of raw PPG/OPPG for the projection formula
- The projected total formula becomes: `(kenpomAdjO_home + kenpomAdjO_away) * tempoFactor / 100` which is the standard KenPom method
- Rank bonuses now based on real KenPom rank (Duke at #5 gets +7, not Saint Louis)

---

## Upgrade 2: NCAAB Referee Tendency Database

**What**: Build a referee tendency database by scraping referee assignment and foul/scoring data, then use it to adjust totals predictions.

**How**:
- New edge function `ncaab-referee-scraper` uses Firecrawl to scrape referee assignment data from ESPN game pages and barttorvik.com (which publishes ref tendencies)
- New table `ncaab_referee_data` stores per-referee stats: avg fouls called, avg total points in their games, over/under rate, pace tendency
- New table `ncaab_game_referees` maps referees to upcoming games
- For each upcoming NCAAB game, look up assigned refs and calculate expected foul/pace impact

**Database changes**:
- New table `ncaab_referee_data`: `id`, `referee_name`, `games_officiated` (int), `avg_fouls_per_game` (numeric), `avg_total_points` (numeric), `over_rate` (numeric), `under_rate` (numeric), `pace_tendency` (text: 'fast', 'neutral', 'slow'), `updated_at`
- New table `ncaab_game_referees`: `id`, `game_date` (date), `home_team` (text), `away_team` (text), `referee_names` (jsonb), `expected_pace_impact` (numeric), `expected_total_adjustment` (numeric)

**Scoring engine update**:
- Before scoring totals, check `ncaab_game_referees` for the matchup
- If refs trend high-foul (avg fouls > league avg + 2): OVER gets +6 bonus, UNDER gets -4
- If refs trend low-foul (avg fouls < league avg - 2): UNDER gets +6 bonus, OVER gets -4
- Add `referee_adjustment` to score breakdown so it's visible in reasoning pills

---

## Upgrade 3: NCAAB Venue Altitude and Travel Fatigue

**What**: Build a venue/location database for NCAAB teams and calculate travel fatigue for college basketball (currently only NBA has this).

**How**:
- New table `ncaab_team_locations` with city, state, latitude, longitude, timezone, and altitude for every D1 program
- Pre-populated with known high-altitude venues: Colorado (5,328 ft), Air Force (6,035 ft), BYU (4,551 ft), Utah (4,226 ft), Wyoming (7,220 ft), Nevada (4,505 ft), New Mexico (5,312 ft), Boise State (2,730 ft)
- New edge function `ncaab-fatigue-calculator` mirrors the NBA fatigue calculator logic but adapted for college schedules (games every 2-3 days, conference travel patterns)
- Calculates: travel distance between games, timezone crossings, altitude differential, back-to-back detection, 3-in-5-day detection
- Stores results in new `ncaab_fatigue_scores` table

**Database changes**:
- New table `ncaab_team_locations`: `id`, `team_name` (text, unique), `city` (text), `state` (text), `latitude` (numeric), `longitude` (numeric), `timezone` (text), `altitude_feet` (integer), `conference` (text)
- New table `ncaab_fatigue_scores`: `id`, `team_name` (text), `opponent` (text), `fatigue_score` (numeric), `fatigue_category` (text), `is_back_to_back` (boolean), `travel_miles` (numeric), `timezone_changes` (integer), `is_altitude_game` (boolean), `altitude_differential` (integer), `game_date` (date), `event_id` (text)

**Scoring engine update**:
- Load `ncaab_fatigue_scores` for today's date
- If a team has fatigue score >= 30: penalize their side by -6 (spread/ML), boost UNDER by +5
- If altitude differential > 3000 ft for visiting team: penalize visitor by -4, boost UNDER by +3
- Cross-country travel (> 1500 miles): penalize by -3
- Add `fatigue_penalty` and `altitude_impact` to score breakdown

---

## Pipeline Integration

Add to `data-pipeline-orchestrator` Phase 1 (Data Collection), in this order:
1. `ncaab-kenpom-scraper` (runs first to get real rankings)
2. `ncaab-team-stats-fetcher` (existing, now supplements KenPom data with ESPN records)
3. `ncaab-referee-scraper` (scrapes ref assignments for today's games)
4. `ncaab-fatigue-calculator` (calculates travel/altitude for today's slate)

All four run before `team-bets-scoring-engine` so the scoring engine has fresh data from all three layers.

---

## Files Changed

1. **NEW** `supabase/functions/ncaab-kenpom-scraper/index.ts` -- Scrapes real KenPom data via Firecrawl
2. **NEW** `supabase/functions/ncaab-referee-scraper/index.ts` -- Scrapes referee assignments and tendencies
3. **NEW** `supabase/functions/ncaab-fatigue-calculator/index.ts` -- Travel/altitude fatigue for NCAAB teams
4. **MODIFY** `supabase/functions/team-bets-scoring-engine/index.ts` -- Add referee adjustment, fatigue/altitude penalties, use real KenPom efficiency numbers
5. **MODIFY** `supabase/functions/data-pipeline-orchestrator/index.ts` -- Add 3 new functions to Phase 1
6. **DATABASE** -- Add columns to `ncaab_team_stats`, create `ncaab_referee_data`, `ncaab_game_referees`, `ncaab_team_locations`, `ncaab_fatigue_scores`

## Expected Impact

| Data Layer | Current State | After Upgrade | Scoring Impact |
|-----------|--------------|---------------|----------------|
| KenPom Rankings | PPG-OPPG derived (Saint Louis #1) | Real adjusted efficiency (Auburn #1) | Every rank bonus correctly applied |
| Referee Data | None | Foul/pace tendencies per ref crew | +/-6 pts on totals when refs trend strongly |
| Venue/Travel | NBA only | Full D1 altitude + travel | -3 to -6 penalty on fatigued/altitude-disadvantaged teams |

