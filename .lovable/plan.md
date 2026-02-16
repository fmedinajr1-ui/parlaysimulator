
# Remove NCAA Baseball from Parlay Generation

## Overview

Block all NCAA Baseball (`baseball_ncaa`) picks from being included in bot-generated parlays until more data is collected. The simulation engine and data pipeline will continue tracking baseball data in the background -- this only affects parlay output.

## What Changes

- NCAA Baseball legs will no longer appear in any generated parlays
- Data collection (odds scraping, scoring, simulation shadow picks) continues unchanged so the data pipeline keeps building history
- Once you're ready, the block can be removed with a single line change

## Technical Details

### File Modified: `supabase/functions/bot-generate-daily-parlays/index.ts`

**1. Add a global blocked sports constant** (near line 228, next to other constants):
```typescript
const BLOCKED_SPORTS = ['baseball_ncaa'];
```

**2. Remove baseball-specific profiles** from all three tiers:
- **Exploration tier** (lines 94-96): Remove the two `baseball_ncaa` profiles (`baseball_totals`, `baseball_spreads`)
- **Validation tier** (line 162): Remove the `validated_baseball_totals` profile
- **Execution tier** (line 221): Remove the `baseball_totals` execution profile

**3. Add a global sport filter** in the candidate pick filtering logic (around line 3278) so that `'all'` sport profiles also exclude blocked sports:
```typescript
// Block picks from paused sports
if (BLOCKED_SPORTS.includes(p.sport)) return false;
```

This filter is added in all three candidate selection branches (team picks, hybrid picks, and player prop picks) so baseball legs cannot sneak into cross-sport or `'all'` parlays.

### What Stays Untouched
- `whale-odds-scraper` -- continues fetching baseball odds
- `team-bets-scoring-engine` -- continues scoring baseball games
- `odds-simulation-engine` -- continues generating shadow picks for baseball
- `bot-settle-and-learn` -- settlement logic stays (for any existing baseball parlays)
- `data-pipeline-orchestrator` -- keeps baseball in the pipeline
- `ncaa-baseball-data-ingestion` -- keeps ingesting ESPN data

### Files Modified
- `supabase/functions/bot-generate-daily-parlays/index.ts`
