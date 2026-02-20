

## Add SportDevs as Alternative Table Tennis Data Source

### Why
The Odds API returns 0 table tennis events most of the time because it only covers major ITTF/WTT tournaments. Daily leagues (Setka Cup, TT Cup, Moscow Liga Pro, TT Elite Series) — which run almost 24/7 — are not listed. SportDevs has a dedicated Table Tennis API that covers these daily leagues with matches, over/under odds, and real-time updates.

### What Changes

**1. Add SportDevs API Key**

You will need to sign up at sportdevs.com and get an API key for their Table Tennis subscription. The key will be stored securely as a backend secret (`SPORTDEVS_API_KEY`).

**2. New Edge Function: `sportdevs-tt-scraper`**

A dedicated scraper that pulls table tennis matches and over/under odds from SportDevs and inserts them into the existing `game_bets` table (same format the scoring engine already reads).

Flow:
- Fetch upcoming matches from `table-tennis.sportdevs.com/matches` (next 24 hours)
- For each match, fetch over/under odds from `table-tennis.sportdevs.com/odds/over-under`
- Also fetch full-time-results (moneyline) for context, though the scoring engine will only use the Over totals
- Normalize and insert into `game_bets` with `sport = 'tennis_pingpong'` so the existing TT scoring model picks them up seamlessly
- Also trigger `tt-stats-collector` to populate player stats for any new players found

**3. Wire Into Pipeline**

Add `sportdevs-tt-scraper` to the data pipeline orchestrator in the data collection phase (Phase 1). It runs alongside the existing `whale-odds-scraper` -- they complement each other (The Odds API covers major tournaments when active; SportDevs covers daily leagues).

**4. Update `whale-odds-scraper` (minor)**

Add a log noting when SportDevs is the primary TT source, so the pipeline logs show which API provided TT data.

### How It Fits Together

```text
Pipeline Phase 1 (Data Collection)
  |
  +-- whale-odds-scraper (NBA, NHL, NCAAB, etc. + TT when available)
  |
  +-- sportdevs-tt-scraper (NEW -- daily TT leagues from SportDevs)
  |       |
  |       +-- Fetches matches -> inserts into game_bets as 'tennis_pingpong'
  |       +-- Fetches over/under odds -> inserts total lines
  |
  +-- tt-stats-collector (populates tt_match_stats for scoring model)
  |
Pipeline Phase 3 (Generation)
  |
  +-- bot-generate-daily-parlays
        |
        +-- calculateTableTennisOverScore() reads game_bets + tt_match_stats
        +-- Applies the formula: P(Over) >= 0.60 -> play Over
```

### Technical Details

| File | Change |
|------|--------|
| `supabase/functions/sportdevs-tt-scraper/index.ts` | New edge function: fetch TT matches + over/under odds from SportDevs API |
| `supabase/functions/data-pipeline-orchestrator/index.ts` | Add `sportdevs-tt-scraper` call in Phase 1 |
| `supabase/config.toml` | Add config entry for the new function |

**SportDevs API Details:**
- Base URL: `https://table-tennis.sportdevs.com`
- Auth: `Authorization: Bearer {SPORTDEVS_API_KEY}`
- Key endpoints:
  - `GET /matches?start_time=gte.{today}&start_time=lt.{tomorrow}` -- upcoming matches
  - `GET /odds/over-under?match_id=eq.{id}` -- over/under lines per match
  - `GET /odds/full-time-results?match_id=eq.{id}` -- moneyline odds
- Pagination: offset/limit (max 50 per request)
- Update frequency: live matches every minute, pre-match every hour

**Data Mapping (SportDevs to game_bets):**
- `match.home_team.name` -> `home_team`
- `match.away_team.name` -> `away_team`
- `match.id` -> `game_id` (prefixed with `sd_` to avoid collisions)
- `match.start_time` -> `commence_time`
- Over/under odds -> `over_odds`, `under_odds`, `line`
- `sport` = `'tennis_pingpong'`
- `bookmaker` = bookmaker name from SportDevs odds response

**Before implementation:** You will be asked to add your SportDevs API key as a secure backend secret.

