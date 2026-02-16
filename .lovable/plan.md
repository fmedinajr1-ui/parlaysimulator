
# Integrate PGA Golf into the Parlay Engine

## Overview

Add PGA Tour golf tournament markets to the data pipeline and parlay generation engine. Golf uses **outright/futures** markets (tournament winner, top-5 finish, top-10 finish, etc.) rather than traditional head-to-head matchups, so this requires a new market type in the scraper and a golf-specific scoring model.

## Key Design Decision: Matchup Props vs. Outrights

The Odds API provides golf as **outrights** (e.g., `golf_masters_tournament_winner`), not head-to-head games. However, some books also offer **matchup props** (Player A vs. Player B round score). The plan starts with **tournament outrights** (winner, top-5, top-10, top-20) since those have the broadest bookmaker coverage and fit cleanly into the existing parlay leg structure as moneyline-style picks.

## What Changes

### Phase 1: Data Collection (whale-odds-scraper)

- Add golf sport keys to a new `GOLF_SPORTS` array:
  - `golf_masters_tournament_winner`
  - `golf_pga_championship_winner`
  - `golf_us_open_winner`
  - `golf_the_open_championship_winner`
- These are **seasonal** -- only active during tournament weeks, so they go in Tier 2
- Fetch outrights using the `outrights` market key instead of `h2h/spreads/totals`
- Store results in `game_bets` with `bet_type: 'outright'` and the player name as one of the teams
- Add `normalizeSportKey` mapping to normalize all golf keys to `golf_pga`

### Phase 2: Scoring Engine (bot-generate-daily-parlays)

- Create a `calculateGolfCompositeScore` function that weights:
  - **Odds Value** (35%): Plus-money outrights with implied probability edge
  - **Course History** (25%): Placeholder -- uses odds movement as proxy initially
  - **Recent Form** (20%): Strokes gained trends (approximated from odds shifts between tournaments)
  - **Field Strength** (10%): Number of top-ranked players in the field
  - **Weather/Course Fit** (10%): Placeholder for future data
- Route golf picks through this engine in `calculateTeamCompositeScore`

### Phase 3: Parlay Profiles

- Add golf exploration profiles (Exploration tier only to start -- same approach as NCAA Baseball):
  - 2x `{ legs: 2, strategy: 'golf_outright', sports: ['golf_pga'], betTypes: ['outright'] }`
  - 1x cross-sport: `{ legs: 3, strategy: 'golf_cross', sports: ['golf_pga', 'basketball_nba'] }`
- **Do NOT add Validation or Execution profiles** until exploration data validates the model
- Add `golf_pga` to the `BLOCKED_SPORTS` list initially so it collects data passively before going live in parlays

### Phase 4: Data Normalization

- Update `normalizeSportKey` in the scraper to map all golf tournament keys to `golf_pga`
- Add golf to the sport key alignment standard

## Technical Details

### whale-odds-scraper/index.ts Changes

1. Add golf tournament keys:
```typescript
const GOLF_SPORTS = [
  'golf_masters_tournament_winner',
  'golf_pga_championship_winner', 
  'golf_us_open_winner',
  'golf_the_open_championship_winner'
];
```

2. Add to `TIER_2_SPORTS` array

3. Add outright-specific fetch logic:
```typescript
// Golf uses outrights market, not h2h/spreads/totals
if (sport.startsWith('golf_')) {
  const url = `...&markets=outrights&...`;
  // Store each outcome as a game_bet with bet_type: 'outright'
}
```

4. Update `normalizeSportKey`:
```typescript
if (sportKey.startsWith('golf_')) return 'golf_pga';
```

### bot-generate-daily-parlays/index.ts Changes

1. Add `calculateGolfCompositeScore` function (~50 lines)
2. Add routing in `calculateTeamCompositeScore`:
```typescript
if (sport.includes('golf')) {
  return calculateGolfCompositeScore(game, betType, side);
}
```
3. Add exploration profiles (commented out initially behind `BLOCKED_SPORTS`)
4. Add `'golf_pga'` to `BLOCKED_SPORTS` for passive data collection phase

### Files Modified
- `supabase/functions/whale-odds-scraper/index.ts` -- golf scraping + normalization
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- scoring engine + profiles

### What This Enables
- Golf odds start flowing into `game_bets` during active tournament weeks
- The simulation engine can generate shadow picks for golf to test accuracy
- Once enough data is collected and shadow pick accuracy is validated, remove `golf_pga` from `BLOCKED_SPORTS` to activate live parlay generation
