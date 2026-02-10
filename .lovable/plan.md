
# Full NCAAB Support -- Implementation Plan

## Current State

NCAAB data is **partially wired**:
- Odds scraper (`whale-odds-scraper`) already fetches NCAAB player props (points, rebounds, assists) and team bets (spreads, totals, moneylines) -- 256 active props in the database right now
- Game scores (`fetch-game-scores`) already has ESPN NCAAB endpoint wired
- Whale signal detector already processes NCAAB signals
- Settlement (`auto-settle-ai-parlays`) maps `basketball_ncaab` correctly

What's **missing**:
1. No `ncaab_player_game_logs` table for player stat history (required for verification and settlement)
2. The `category-props-analyzer` only queries `nba_player_game_logs` -- NCAAB players never get sweet spot picks generated
3. The `bot-generate-daily-parlays` profiles don't include `basketball_ncaab` as a sport option
4. `verify-sweet-spot-outcomes` only queries `nba_player_game_logs` -- NCAAB picks can never be verified
5. `bot-settle-and-learn` team settlement only queries `nba_player_game_logs` -- NCAAB team legs can never settle
6. No NCAAB team intelligence tables (no pace, defense rankings, or home court data)
7. No NCAAB data ingestion function

## Plan

### Phase 1: Database Tables

**1a. Create `ncaab_player_game_logs` table**
Same schema as `nba_player_game_logs` plus a `team` column for settlement lookups:
- `id`, `player_name`, `team`, `game_date`, `opponent`, `minutes_played`, `points`, `rebounds`, `assists`, `threes_made`, `blocks`, `steals`, `turnovers`, `is_home`, `created_at`
- Unique constraint on `(player_name, game_date)`

**1b. Create `ncaab_team_stats` table**
Simplified team intelligence (college basketball has 350+ teams, so we use a simpler model than NBA):
- `id`, `team_name`, `conference`, `kenpom_rank`, `adj_offense`, `adj_defense`, `adj_tempo`, `home_record`, `away_record`, `ats_record`, `over_under_record`, `updated_at`
- Unique constraint on `team_name`

### Phase 2: Data Ingestion

**2a. Create `ncaab-data-ingestion` edge function**
- Fetches NCAAB player game logs from ESPN box scores API for players found in `unified_props`
- Populates `ncaab_team_stats` with KenPom-style efficiency metrics (initially seeded with approximate conference-level data for top 100 teams)
- Queries ESPN for recent box scores and extracts individual player stats
- Runs on same cron schedule as `pvs-data-ingestion`

### Phase 3: Analysis Pipeline

**3a. Update `category-props-analyzer`**
- Add a sport-aware query: when processing props, check the `sport` field from `unified_props`
- For `basketball_ncaab` props, query `ncaab_player_game_logs` instead of `nba_player_game_logs`
- This allows NCAAB player sweet spots to be generated with proper L10 stats

### Phase 4: Bot Parlay Generation

**4a. Update `bot-generate-daily-parlays` profiles**
- Add `basketball_ncaab` to existing exploration profiles (mix in with NBA)
- Add 3-5 dedicated NCAAB profiles at exploration tier
- Add 2 NCAAB validation profiles
- Add 1 NCAAB execution profile
- Update team composite scoring to handle NCAAB teams using `ncaab_team_stats` (tempo, efficiency)

### Phase 5: Settlement Pipeline

**5a. Update `verify-sweet-spot-outcomes`**
- Make game log query sport-aware: if pick's player exists in `ncaab_player_game_logs`, use that table
- Fallback: try both `nba_player_game_logs` and `ncaab_player_game_logs`

**5b. Update `bot-settle-and-learn`**
- In `settleTeamLeg`, detect NCAAB sport from leg data
- Query `ncaab_player_game_logs` for NCAAB team score aggregation
- Use `fetch-game-scores` (already has NCAAB ESPN support) as primary score source

### Phase 6: Category Weights

**6a. Seed NCAAB category weights in `bot_category_weights`**
- Add entries for NCAAB-specific categories: `NCAAB_POINTS`, `NCAAB_REBOUNDS`, `NCAAB_ASSISTS` with `sport = 'basketball_ncaab'`
- Initial weight of 1.0, will calibrate through the learning loop

## Technical Details

### Files to Create
- `supabase/functions/ncaab-data-ingestion/index.ts` -- new edge function for NCAAB game log and team stat ingestion

### Files to Modify
- `supabase/functions/category-props-analyzer/index.ts` -- add NCAAB game log source
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- add NCAAB profiles and team scoring
- `supabase/functions/verify-sweet-spot-outcomes/index.ts` -- sport-aware game log lookup
- `supabase/functions/bot-settle-and-learn/index.ts` -- NCAAB team settlement

### Database Migrations
1. Create `ncaab_player_game_logs` table
2. Create `ncaab_team_stats` table
3. Seed `bot_category_weights` with NCAAB categories

### Deployment Order
1. Database migrations (tables first)
2. Deploy `ncaab-data-ingestion` and trigger initial seed
3. Deploy updated `category-props-analyzer`
4. Deploy updated `bot-generate-daily-parlays`
5. Deploy updated verification and settlement functions
6. Seed category weights

This will give NCAAB the same full pipeline as NBA: scrape odds, generate game logs, analyze sweet spots, build parlays, verify outcomes, settle, and learn.
