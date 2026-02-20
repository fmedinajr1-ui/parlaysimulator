

## Add MLB to the Betting Pipeline

### Overview
Add Major League Baseball (`baseball_mlb`) as a fully supported sport in the scraper and data ingestion pipeline. Since the season just started, we'll build the infrastructure now and backfill 2024 data from ESPN to research hit rates on RBIs, hits, total bases, and pitcher strikeouts.

### Phase 1: Add MLB to the Odds Scraper

**File:** `supabase/functions/whale-odds-scraper/index.ts`

- Move `baseball_mlb` into `TIER_2_SPORTS` (seasonal, fetch when games exist)
- Add MLB player prop market batches using the same market keys already proven with NCAA baseball:

```
'baseball_mlb': [
  ['batter_hits', 'batter_rbis', 'batter_runs_scored', 'batter_total_bases'],
  ['batter_home_runs', 'batter_stolen_bases', 'pitcher_strikeouts', 'pitcher_outs'],
],
```

This will scrape MLB moneylines, spreads, totals, AND player props into `unified_props` automatically.

---

### Phase 2: Create MLB Player Game Logs Table

**Database Migration:** Create `mlb_player_game_logs` table modeled after the existing `ncaa_baseball_player_game_logs` schema:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| player_name | text | Not null |
| team | text | Not null |
| game_date | date | Not null |
| opponent | text | |
| at_bats | integer | |
| hits | integer | For hit rate research |
| runs | integer | |
| rbis | integer | For RBI over/under research |
| home_runs | integer | |
| stolen_bases | integer | |
| walks | integer | |
| strikeouts | integer | |
| batting_avg | numeric | |
| total_bases | integer | Key stat for props |
| innings_pitched | numeric | Nullable (pitchers only) |
| earned_runs | integer | Nullable |
| pitcher_strikeouts | integer | Nullable |
| pitcher_hits_allowed | integer | Nullable |
| is_home | boolean | |
| created_at | timestamptz | Default now() |

Unique constraint on `(player_name, game_date)` for upsert support. Add a `total_bases` column that NCAA baseball table lacks -- critical for MLB props research.

---

### Phase 3: Create MLB Data Ingestion Edge Function

**New file:** `supabase/functions/mlb-data-ingestion/index.ts`

Closely mirrors the existing `ncaa-baseball-data-ingestion` function but uses MLB ESPN endpoints:
- Scoreboard: `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard`
- Summary: `https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/summary`

Key differences from NCAA version:
- Uses `baseball_mlb` sport key for prop matching
- Adds `total_bases` calculation (singles + 2x doubles + 3x triples + 4x HR)
- Adds `pitcher_hits_allowed` parsing
- Supports `days_back` parameter (set to 120+ for 2024 backfill)
- Logs to `cron_job_history` as `mlb-data-ingestion`

---

### Phase 4: Backfill 2024 Season Data

After deploying the ingestion function, invoke it with `{ "days_back": 220 }` to pull the full 2024 MLB season (roughly April-September 2024). This gives us ~180 games per team to research hit rates on:

- **Batter Hits O/U** (e.g., Over 1.5 hits)
- **Batter RBIs O/U** (e.g., Over 0.5 RBIs)
- **Batter Total Bases O/U**
- **Pitcher Strikeouts O/U**

This historical data will let the sweet spot analysis and hit rate calculations work immediately once props start flowing in.

---

### Technical Details

**Files to create:**
1. `supabase/functions/mlb-data-ingestion/index.ts` -- new edge function

**Files to modify:**
1. `supabase/functions/whale-odds-scraper/index.ts` -- add `baseball_mlb` to TIER_2 + market batches

**Database changes:**
1. Create `mlb_player_game_logs` table with RLS (service role only for writes, public read)

**Deployment steps:**
1. Run database migration for new table
2. Edit scraper to include MLB
3. Create and deploy MLB ingestion function
4. Backfill 2024 data via function invocation
5. Verify props flowing and historical data available for hit rate analysis

