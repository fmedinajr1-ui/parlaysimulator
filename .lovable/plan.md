

# Continuous Odds Simulation + Sport-Specific Scoring Engine

## The Problem

Right now:
- All sports except NCAAB use the same generic team scoring formula (defense rank, pace, home court) which doesn't fit hockey, baseball, or tennis
- There's no way to validate whether the scoring models are actually accurate before putting money on them
- The scraper already pulls odds from The Odds API (FanDuel, DraftKings, BetMGM, Caesars lines) -- no need to scrape sportsbook websites directly

## The Solution: Two-Part Build

### Part 1: Sport-Specific Scoring Engines

Replace the one-size-fits-all `calculateTeamCompositeScore` with dedicated scoring functions per sport. Each uses factors that actually matter for that sport.

**NBA** (existing, keep as-is):
- Pace rating, defense rank, home court cover rate, blowout probability, shootout factor

**NHL** (new: `calculateNhlTeamCompositeScore`):
- Save percentage and goals-against average for UNDER totals
- Power play percentage and shots-on-goal for OVER totals
- Home ice advantage (weaker than NBA -- worth ~2 pts, not 5)
- Goalie starter confirmation (from injury feed)
- Back-to-back fatigue (bigger deal in hockey than basketball)

**NCAA Baseball** (new: `calculateBaseballTeamCompositeScore`):
- ERA differential (pitcher matchup is king)
- Run differential and batting average
- Home/away splits (college baseball has massive home-field advantage)
- Weather integration (wind, temperature from existing `ai-research-agent` weather queries)
- National rank from existing `ncaa_baseball_team_stats`

**Tennis** (new: `calculateTennisCompositeScore`):
- Head-to-head record
- Surface-specific win rate (hard, clay, grass)
- Recent form (last 5 match win rate)
- Ranking differential
- Sets handicap vs moneyline alignment

**WNBA** (new: `calculateWnbaTeamCompositeScore`):
- Similar to NBA but with adjusted pace thresholds (WNBA games are slower)
- Smaller home court bonus
- Rest advantage (WNBA schedule is more compressed)

Each function returns `{ score: number, breakdown: Record<string, number> }` matching the existing pattern.

### Part 2: Simulation Sandbox (Accuracy Validator)

A new edge function `odds-simulation-engine` that runs a continuous validation loop:

**How it works:**
1. Every time the scraper pulls fresh odds, the simulator scores them using the sport-specific engines
2. It generates "shadow picks" -- predictions that are logged but never bet on
3. When games finish, it compares predictions vs outcomes per sport per bet type
4. It calculates rolling accuracy metrics and stores them in a new `simulation_accuracy` table

**Table: `simulation_accuracy`**

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| sport | text | Sport key (basketball_nba, icehockey_nhl, etc.) |
| bet_type | text | spread, total, h2h, player_points, etc. |
| scoring_version | text | Engine version for A/B testing |
| predictions_made | int | Total shadow picks |
| predictions_correct | int | Hits |
| accuracy_rate | float | Hit rate (0-1) |
| avg_composite_score | float | Average score of predictions |
| period_start | date | Window start |
| period_end | date | Window end |
| is_production_ready | boolean | Accuracy above threshold for live use |
| created_at | timestamp | Record creation |

**Table: `simulation_shadow_picks`**

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| sport | text | Sport key |
| event_id | text | Game ID |
| bet_type | text | Type of bet |
| side | text | over/under/home/away |
| predicted_score | float | Composite score from engine |
| line | float | The line at prediction time |
| odds | int | American odds |
| outcome | text | won/lost/push/pending |
| settled_at | timestamp | When settled |
| scoring_version | text | Which engine version |
| score_breakdown | jsonb | Full breakdown for analysis |
| created_at | timestamp | Record creation |

**Production Gate:** A sport's scoring engine only feeds into the real parlay generator once its simulation accuracy exceeds a configurable threshold (default: 55% for spreads/totals, 52% for moneylines). Until then, it runs in shadow mode only.

### Part 3: Integration with Bot Generator

Update the parlay generator's `buildTeamPickPool` to:
1. Route each sport to its dedicated scoring function
2. Check `simulation_accuracy` for that sport -- if accuracy is below threshold, skip that sport entirely
3. Log which sports are "production ready" vs "still simulating"

### Workflow

```text
Scraper pulls odds (every 15-30 min)
       |
       v
Simulation Engine scores all games with sport-specific models
       |
       v
Shadow picks logged to simulation_shadow_picks
       |
       v
Settlement verifies outcomes, updates simulation_accuracy
       |
       v
Bot Generator checks accuracy gates before including sport
       |
       v
Only sports passing accuracy threshold enter real parlays
```

## Technical Changes

### Files Modified

1. **`supabase/functions/bot-generate-daily-parlays/index.ts`**
   - Add `calculateNhlTeamCompositeScore()`, `calculateBaseballTeamCompositeScore()`, `calculateTennisCompositeScore()`, `calculateWnbaTeamCompositeScore()`
   - Update `calculateTeamCompositeScore()` router to dispatch by sport key
   - Add accuracy gate check in `buildTeamPickPool` that queries `simulation_accuracy`

2. **New: `supabase/functions/odds-simulation-engine/index.ts`**
   - Accepts `mode: 'predict' | 'settle' | 'report'`
   - `predict`: Scores all active `game_bets` using sport-specific engines, inserts shadow picks
   - `settle`: Checks finished games, marks shadow picks as won/lost/push
   - `report`: Returns accuracy breakdown by sport and bet type

3. **Database migrations**
   - Create `simulation_accuracy` table
   - Create `simulation_shadow_picks` table
   - Both with RLS policies for service role access

### Pipeline Integration

The `data-pipeline-orchestrator` gets a new phase after odds collection:
- Call `odds-simulation-engine` with `mode: 'predict'` after every scrape
- Call `odds-simulation-engine` with `mode: 'settle'` during the settlement phase

### Sport-Specific Scoring Details

**NHL scoring factors and weights:**
- Goalie save %: 25% weight (strongest predictor for totals)
- Goals-against avg: 20%
- Power play %: 15%
- Shots on goal avg: 15%
- Home ice: 10% (worth ~1.5 goals less than NBA home court)
- Back-to-back: 15% penalty

**Baseball scoring factors:**
- ERA matchup: 30% weight
- Run differential: 20%
- Batting avg: 15%
- Home field: 15%
- National rank: 10%
- Weather: 10%

**Tennis scoring factors:**
- H2H record: 25%
- Surface win rate: 25%
- Ranking diff: 20%
- Recent form (L5): 20%
- Fatigue (days since last match): 10%

