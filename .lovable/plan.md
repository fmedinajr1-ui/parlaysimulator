

# Replace Whale-Only Scoring with a Multi-Layer Intelligence Funnel for Team Bets

## The Problem

Right now, the Team Bets page shows `sharp_score` from the whale signal detector, which is a **single-factor** system: it only compares sportsbook line differences (book-to-book divergence). That's a market noise detector, not an accuracy engine.

Meanwhile, a **much richer** composite scoring engine already exists inside the parlay builder -- it uses KenPom efficiency ratings, tempo, ATS records, rank differentials, home court advantage, and conference context. But those scores are trapped inside parlay generation and never surface on the Team Bets page.

**Current flow (weak):**
```text
Odds API --> whale-odds-scraper --> game_bets (raw odds)
                                        |
whale-signal-detector ---- sharp_score (book divergence only, 55-65 avg)
                                        |
                                  Team Bets UI (shows weak scores)
```

**Proposed flow (multi-layer):**
```text
Odds API --> whale-odds-scraper --> game_bets (raw odds)
                                        |
NEW: team-bets-scoring-engine ----------+---- composite_score (multi-factor)
  |                                               |
  +-- Layer 1: KenPom Intelligence (NCAAB)       |
  |   efficiency, tempo, rank, ATS records        |
  +-- Layer 2: Sharp Money Signals               |
  |   book divergence, odds movement              |
  +-- Layer 3: Situational Factors               |
  |   home court, conference rivalry, rest days    |
  +-- Layer 4: Historical Validation             |
  |   ATS/O-U records as confirmation             |
                                                   |
                                            Team Bets UI (shows rich scores + reasoning)
```

## What Changes

### 1. Create `team-bets-scoring-engine` (new backend function)

A dedicated scoring function that runs **after** odds are scraped and enriches every `game_bets` row with a multi-factor composite score. This replaces the whale detector as the primary scoring source for team bets.

**Scoring layers for NCAAB:**
- **KenPom Efficiency Edge** (0-20 pts): Net efficiency differential between teams
- **Tempo Alignment** (0-18 pts): Does the tempo support the over/under direction?
- **Rank Differential** (0-10 pts): Top 25 vs unranked = high confidence
- **ATS / O-U Track Record** (0-8 pts): Teams that consistently cover or go over
- **Home Court Factor** (0-6 pts): College home court is worth ~3.5 points
- **Sharp Money Confirmation** (0-15 pts): Book divergence as a bonus layer, not the only signal
- **Conference Game Penalty** (-5 pts): Conference rivals are harder to predict
- **Close Spread Penalty** (-8 pts): Spreads under 3 points are coin flips

The function writes `composite_score`, `recommended_side`, and `score_breakdown` (JSON) back to `game_bets`. This makes every row self-documenting -- the UI can show exactly *why* a pick is recommended.

### 2. Add `composite_score` and `score_breakdown` columns to `game_bets`

New columns to store the multi-factor score alongside the existing `sharp_score`:
- `composite_score` (numeric): The final blended score (30-95 range)
- `score_breakdown` (jsonb): Factor-by-factor breakdown for UI display

The existing `sharp_score` stays as one input layer; `composite_score` becomes the primary display score.

### 3. Update Team Bets UI to show `composite_score` + reasoning

- Display `composite_score` instead of `sharp_score` as the main confidence indicator
- Show the top 2-3 scoring factors from `score_breakdown` as context pills (e.g., "Efficiency edge: +12 pts", "Fast tempo: 73.2")
- Color-code the score: 75+ green (strong), 65-74 yellow (moderate), below 65 gray (weak)
- Filter: only show picks with `composite_score >= 62` (quality floor)

### 4. Wire into the pipeline orchestrator

Add `team-bets-scoring-engine` to the data pipeline after the odds scraper runs, so scores are always fresh when users open the page. Run sequence:
1. `whale-odds-scraper` (fetches odds into `game_bets`)
2. `team-bets-scoring-engine` (enriches with composite scores)
3. `whale-signal-detector` (continues generating whale picks separately)

### 5. Sport-specific scoring profiles

The engine will use different factor weights per sport:

**NCAAB** (richest data): KenPom efficiency + tempo + rank + ATS records + home court
**NHL** (when added): Shot differential + save percentage + home ice + rest days
**NBA** (when games resume): Pace + defensive rating + fatigue + Vegas environment

This makes the system extensible -- each sport gets the factors that actually predict outcomes for that sport type.

## Technical Details

### New file: `supabase/functions/team-bets-scoring-engine/index.ts`
- Fetches all active `game_bets` grouped by sport
- For NCAAB: loads `ncaab_team_stats`, applies the same composite scoring logic currently in `bot-generate-daily-parlays` (efficiency, tempo, rank, ATS, home court)
- Picks the best side per game+bet_type (highest composite score wins)
- Writes `composite_score`, `recommended_side`, and `score_breakdown` back to `game_bets`
- Reuses the existing `resolveNcaabTeam()` fuzzy matching and `NCAAB_NAME_MAP`

### Database migration
- Add `composite_score NUMERIC` to `game_bets`
- Add `score_breakdown JSONB` to `game_bets`

### Modified files
1. **`src/components/team-bets/TeamBetCard.tsx`** -- Display `composite_score` as primary score, show breakdown pills
2. **`src/components/team-bets/TeamBetsDashboard.tsx`** -- Sort by `composite_score` DESC, apply quality floor filter (>= 62)
3. **`supabase/functions/data-pipeline-orchestrator/index.ts`** -- Add `team-bets-scoring-engine` to Phase 2 (Analysis)

### Why this is more accurate than whale-only

The whale signal detector answers: "Are books disagreeing?" (market noise)
The composite engine answers: "Based on team strength, tempo, track record, and market signals combined, which side has the edge?" (multi-factor intelligence)

For NCAAB specifically, KenPom efficiency differentials are the single most predictive factor for spreads (correlation ~0.65 with ATS outcomes). Tempo is the strongest predictor for totals. The whale detector captures neither -- it only sees if DraftKings and FanDuel have different lines, which happens randomly.

