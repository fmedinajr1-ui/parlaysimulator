

# Enable NCAA Baseball in Bot Parlay Generation + Scoring Engine

## Current State

| Component | Status |
|---|---|
| Database tables | Created (234 teams, but all stats null -- pre-season) |
| Odds scraper | Wired for `baseball_ncaa` markets |
| Pipeline orchestrator | Calls ingestion + team stats functions |
| **Scoring engine** | No `baseball_ncaa` scorer -- falls through to generic |
| **Bot parlay generator** | No `baseball_ncaa` profiles -- never generates baseball parlays |
| **UI (Team Bets page)** | No baseball tab |

The bot can't produce NCAA baseball parlays because there are zero generation profiles for `baseball_ncaa` and the scoring engine has no baseball-specific logic.

## Plan

### 1. Add Baseball Scoring to `team-bets-scoring-engine`

**File**: `supabase/functions/team-bets-scoring-engine/index.ts`

Create a `scoreBaseballNcaa()` function modeled on `scoreNcaab()`:
- Load `ncaa_baseball_team_stats` (runs_per_game, runs_allowed_per_game, era, batting_avg, national_rank)
- Score based on:
  - **Run differential** (runs_per_game - runs_allowed_per_game) -- primary signal
  - **ERA advantage** for totals (lower ERA = under lean)
  - **Batting avg** for run production
  - **National rank** bonus (top 25 teams get +5-10 pts)
  - **Home/away record** when available
- Add `isBaseballNcaa` detection (`sport?.includes('baseball_ncaa')`) alongside the existing NCAAB/NHL checks
- Quality floor of 55 (similar to NCAAB's 62)

### 2. Add Baseball Profiles to `bot-generate-daily-parlays`

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

Add 5 exploration profiles for NCAA baseball:
```text
Exploration tier:
- 3-leg baseball_ncaa totals x2
- 3-leg baseball_ncaa spreads x1  
- 3-leg baseball_ncaa mixed (spread + total) x1
- 3-leg cross-sport (baseball_ncaa + basketball_ncaab) x1

Validation tier:
- 3-leg validated baseball totals x1
- 3-leg validated baseball spreads x1

Execution tier:
- 3-leg baseball totals (composite-sorted) x1
```

### 3. Add Baseball Tab to Team Bets UI

**File**: `src/pages/TeamBets.tsx` (or equivalent)

Add a `baseball_ncaa` tab alongside the existing NBA, NHL, and NCAAB tabs so scored baseball picks are visible in the dashboard.

### 4. Test with Synthetic Data

Since the season hasn't started and all team stats are null, insert a handful of test rows into `ncaa_baseball_team_stats` with realistic values, and a few test `game_bets` with `sport = 'baseball_ncaa'`. Then:
1. Run `team-bets-scoring-engine` to verify baseball bets get scored
2. Run `bot-generate-daily-parlays` to verify baseball parlays generate
3. Clean up test data after verification

### Files Changed

1. **Edit**: `supabase/functions/team-bets-scoring-engine/index.ts` -- add `scoreBaseballNcaa()` + load `ncaa_baseball_team_stats`
2. **Edit**: `supabase/functions/bot-generate-daily-parlays/index.ts` -- add ~8 baseball profiles across tiers
3. **Edit**: Team Bets UI page -- add baseball_ncaa tab
4. **Test**: Insert synthetic data, run scoring + generation, verify, clean up

