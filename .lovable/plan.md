

# Regenerate Parlays with Top Baseball Sharp Signals + NCAAB

## Current State
- **13 parlays** exist for today (all exploration tier)
- **6 high-quality baseball picks** identified with sharp scores 70-95:
  1. Clemson vs Army **Over 12** (composite 78, sharp 78)
  2. Clemson **-4.5** vs Army (composite 70, sharp 70)
  3. Charlotte **-1.5** vs San Diego (composite 70, sharp 70)
  4. Oregon St **-3.5** vs Michigan (composite 69, sharp 95)
  5. UNC Greensboro **+2.5** vs Kentucky (composite 69, sharp 95)
  6. East Carolina **-2.5** vs Xavier (composite 69, sharp 85)
  7. Washington **+2.5** vs NC State (composite 69, sharp 85)
- **NCAAB picks are weak today** - only 1 matchup at 60 composite score (Manhattan vs Niagara)

## Plan

### Step 1: Clear today's existing parlays
Delete the 13 current parlays to allow fresh generation with better data.

### Step 2: Re-trigger the generation engine
Call `bot-generate-daily-parlays` to regenerate. The engine will now pick up all the enriched baseball data (with proper team name matching from the alias fix) and the limited NCAAB picks.

### Step 3: Verify results
Query the new parlays to confirm they include the top baseball sharp signal picks (Clemson total, Oregon St spread, UNCG spread, etc.) and check leg composition.

## Technical Details

- **Database**: `DELETE FROM bot_daily_parlays WHERE parlay_date = '2026-02-13'`
- **Edge Function**: Invoke `bot-generate-daily-parlays` with default params
- **Verification**: Query `bot_daily_parlays` to confirm baseball legs are included with the correct team names and lines

Since NCAAB quality is very low today (only 1 pick above 55), the regenerated parlays will be heavily baseball-weighted, which aligns with where the sharp signals are strongest.

