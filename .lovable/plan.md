

## Scrape Double Doubles, Triple Doubles, Team Moneylines + Correct-Priced Lines Funnel

### Overview
Add three new data types (double doubles, triple doubles, team moneylines) to the scraping pipeline AND run them through the correct-priced/mispriced lines fork so they produce both mispriced (15%+) and correct-priced (3-14%) entries.

---

### 1. Add DD/TD to PP Props Scraper

**File:** `supabase/functions/pp-props-scraper/index.ts`

Add to `STAT_TYPE_MAP` (line ~111):
- `'Double Doubles'` -> `'player_double_double'`
- `'Triple Doubles'` -> `'player_triple_double'`

These already flow through PrizePicks API -- they're just unmapped and get dropped. Once mapped, they'll land in `pp_projection_snapshots` automatically.

### 2. Add DD/TD to Sportsbook Props Scraper

**File:** `supabase/functions/sportsbook-props-scraper/index.ts`

Add to `STAT_TYPE_MAP` (line ~33):
- `'double doubles'` -> `'player_double_double'`
- `'triple doubles'` -> `'player_triple_double'`

This ensures any sportsbook odds for these markets get normalized into `unified_props`.

### 3. New Edge Function: `fetch-team-moneylines`

**New file:** `supabase/functions/fetch-team-moneylines/index.ts`

Fetches h2h (moneyline) odds from The Odds API for NBA, MLB, NHL, NFL, NCAAB. Persists into a new `team_moneyline_odds` table. Uses the existing `THE_ODDS_API_KEY` secret.

Logic:
- Loop through sport keys: `basketball_nba`, `baseball_mlb`, `icehockey_nhl`, `americanfootball_nfl`, `basketball_ncaab`
- Call `https://api.the-odds-api.com/v4/sports/{sport}/odds/?apiKey={key}&regions=us&markets=h2h&oddsFormat=american`
- Parse each event into rows with home/away teams, odds, implied probabilities
- Upsert into `team_moneyline_odds`

### 4. New Database Table: `team_moneyline_odds`

```text
Columns:
  id              uuid PRIMARY KEY
  sport           text
  event_id        text
  home_team       text
  away_team       text
  home_odds       numeric
  away_odds       numeric
  bookmaker       text
  commence_time   timestamptz
  implied_home_prob numeric
  implied_away_prob numeric
  analysis_date   date DEFAULT CURRENT_DATE
  created_at      timestamptz DEFAULT now()
  UNIQUE(event_id, bookmaker, analysis_date)
```

Public read, service role write. RLS enabled.

### 5. Update `detect-mispriced-lines` -- DD/TD + Moneyline Edge Detection

**File:** `supabase/functions/detect-mispriced-lines/index.ts`

**Double Double / Triple Double edge detection:**
- Add `'player_double_double'` and `'player_triple_double'` to `NBA_PROP_TO_STAT` mapping
- For these binary props (line = 0.5), calculate edge differently: compute historical DD/TD frequency from game logs (e.g., games with pts >= 10 AND reb >= 10 = double double), compare frequency vs implied probability from the 0.5 line
- Fork result into mispriced (15%+) or correct-priced (3-14%) like all other props

**Team moneyline mispricing:**
- Fetch today's `team_moneyline_odds` and today's `team_bets_scoring` composite scores
- For each game: if composite score >= 70 but implied probability is low (e.g., team at +150 = 40% implied, but model says 65%+), flag as mispriced moneyline
- Store in `mispriced_lines` with `sport` and `prop_type = 'team_moneyline'`
- Apply same 3-14% / 15%+ fork for correct-priced vs mispriced

### 6. Correct-Priced Lines Funnel

All three new data types (DD, TD, moneylines) flow through the **existing** correct-priced/mispriced fork already in `detect-mispriced-lines`. The fork at line ~407 already routes 3-14% edge to `correct_priced_lines` and 15%+ to `mispriced_lines`. The new prop types just need to produce `resultEntry` objects with the same shape, and they'll automatically land in the right table.

---

### Files Modified
- `supabase/functions/pp-props-scraper/index.ts` -- add DD/TD stat type mappings
- `supabase/functions/sportsbook-props-scraper/index.ts` -- add DD/TD stat type mappings
- `supabase/functions/detect-mispriced-lines/index.ts` -- add DD/TD binary edge calc + moneyline mispricing via team scoring engine
- **New:** `supabase/functions/fetch-team-moneylines/index.ts` -- dedicated moneyline scraper
- **New migration:** `team_moneyline_odds` table

### No Breaking Changes
All existing pipelines remain untouched. New data flows through the same infrastructure.

