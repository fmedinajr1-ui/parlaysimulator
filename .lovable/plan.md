

# Add Tennis and Table Tennis for Nighttime Parlays

## Overview
Expand the data pipeline and parlay generator to cover Tennis (ATP/WTA) and Table Tennis for nighttime action. Tennis already has partial support (whale signal detector, 2 exploration profiles) but isn't scraped for odds. Table Tennis is brand new.

## The Odds API Sport Keys
- Tennis: `tennis_atp`, `tennis_wta` (already known in codebase)
- Table Tennis: `tennis_pingpong` (The Odds API key for international table tennis)

## Changes Required

### 1. Whale Odds Scraper (`supabase/functions/whale-odds-scraper/index.ts`)
- Add `tennis_atp`, `tennis_wta`, and `tennis_pingpong` to `TIER_2_SPORTS` (currently excluded as "Tier 3 / skip")
- Add market batches for these sports (tennis uses `h2h`, `spreads`, `totals`; table tennis uses `h2h`, `totals`)
- This populates `game_bets` with team-level odds for tennis matches and table tennis matches

### 2. Parlay Generator Profiles (`supabase/functions/bot-generate-daily-parlays/index.ts`)

**Exploration tier** -- add 6 new profiles:
- 2x `tennis_focus` 3-leg (already exist, but add `tennis_pingpong` to the sports filter)
- 2x `table_tennis_focus` 3-leg for pure table tennis parlays
- 2x `nighttime_mixed` 4-leg mixing tennis + table tennis + NHL (nighttime sports)

**Validation tier** -- add 2 new profiles:
- 1x `validated_tennis` 3-leg for tennis moneyline/totals
- 1x `validated_nighttime` 3-leg mixing tennis + table tennis

**No execution tier changes** -- these are new sports without historical accuracy data; keep them in exploration/validation until performance data accumulates.

### 3. Settlement Pipeline (`supabase/functions/bot-settle-and-learn/index.ts`)

Add tennis/table tennis settlement routing in `settleTeamLeg`:
- Use The Odds API scores endpoint (`/v4/sports/{sport}/scores`) to check match results (since ESPN doesn't cover table tennis)
- Fallback: mark as `no_data` if scores unavailable (same as other unsettled sports)
- Tennis and table tennis legs are moneyline or total bets, so `resolveTeamOutcome` already handles the grading logic once scores are provided

### 4. Unified Live Feed (`supabase/functions/unified-live-feed/index.ts`)

Add tennis/table tennis to the `normalizeSport` map:
```
'tennis_atp': 'ATP Tennis',
'tennis_wta': 'WTA Tennis', 
'tennis_pingpong': 'Table Tennis',
```

### 5. Sport Key Alignment

Update the following to recognize the new keys:
- `whale-signal-detector`: add `tennis_pingpong` to `ALL_SPORTS` and `SPORT_THRESHOLDS`
- `track-odds-movement`: add tennis/table tennis sport key mappings

## Technical Details

### Settlement via Odds API Scores
Since ESPN doesn't cover table tennis, settlement will use The Odds API scores endpoint:
```
GET /v4/sports/tennis_pingpong/scores?apiKey=KEY&daysFrom=3
```
This returns completed match scores which can be used to grade moneyline and total bets.

### Market Types
| Sport | Markets | Bet Types |
|-------|---------|-----------|
| Tennis ATP/WTA | h2h, spreads, totals | moneyline, spread, total |
| Table Tennis | h2h, totals | moneyline, total |

### Files to Edit
1. `supabase/functions/whale-odds-scraper/index.ts` -- add sports + markets
2. `supabase/functions/bot-generate-daily-parlays/index.ts` -- add profiles
3. `supabase/functions/bot-settle-and-learn/index.ts` -- add score-based settlement
4. `supabase/functions/unified-live-feed/index.ts` -- add sport name mapping
5. `supabase/functions/whale-signal-detector/index.ts` -- add table tennis to supported sports
6. `supabase/functions/track-odds-movement/index.ts` -- add sport key mappings (if needed for sharp signals)

