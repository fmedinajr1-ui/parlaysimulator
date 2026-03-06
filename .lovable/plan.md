

# Check MLB Picks — Root Cause & Fix Plan

## What's Happening

Two issues are preventing MLB picks from being settled:

1. **MLB game logs are 2 weeks stale** — the latest entry in `mlb_player_game_logs` is from Feb 20. The ingestion function either isn't scheduled or is failing. Without fresh game logs, there's nothing to compare picks against.

2. **The settlement function ignores MLB (and NHL)** — `verify-sweet-spot-outcomes` only queries NBA and NCAAB game logs. MLB and NHL picks sit permanently as `pending` → `no_data`.

This means every MLB pick since the system launched has **never been settled** — all 230+ daily picks show `no_data`.

## Fix Plan

### 1. Add MLB + NHL game log support to `verify-sweet-spot-outcomes`

- Fetch `mlb_player_game_logs` in the same date window alongside NBA/NCAAB
- Add MLB prop-to-stat mapping: `hits` → `hits`, `runs` → `runs`, `total_bases` → `total_bases`, `pitcher_strikeouts` → `pitcher_strikeouts`, `hitter_fantasy_score` → computed
- Fetch `nhl_player_game_logs` similarly with NHL stat mappings
- Merge all logs into the unified `gameLogMap` for settlement

### 2. Fix MLB game log ingestion schedule

- Check if `mlb-data-ingestion` has an active cron job — if not, add one
- Verify it's pulling current 2026 season data

### 3. Backfill settlements

- After deploying the fix, run `verify-sweet-spot-outcomes` for recent dates to settle any MLB/NHL picks that have game log coverage

### Files Changed
1. `supabase/functions/verify-sweet-spot-outcomes/index.ts` — add MLB + NHL game log fetching and stat mapping

### Technical Details

**MLB stat mapping to add:**
```typescript
// MLB prop types → mlb_player_game_logs columns
'hits': 'hits',
'runs': 'runs', 
'total_bases': 'total_bases',
'pitcher_strikeouts': 'pitcher_strikeouts',
'hitter_fantasy_score': computed (hits*3 + runs*2 + rbis*2 + walks + stolen_bases*2 + home_runs*4)
```

**NHL stat mapping to add:**
```typescript
// NHL prop types → nhl_player_game_logs columns  
'points': 'points', 'shots': 'shots',
'assists': 'assists', 'goals': 'goals'
```

