

# Smart API Budget Plan for 100K Odds API Requests

## The Problem

The whale-odds-scraper currently runs **every 5 minutes** (288 times/day), making **165 API calls per run**. That's **~47,500 calls/day** -- your 100K would be gone in 2 days.

Most of those calls are wasted: the scraper fetches odds for **14 sports**, **6+ markets each**, across **15 events per sport** -- even when most sports have no games or the bot doesn't need fresh data yet.

## The Strategy: "Scout First, Then Pull Odds"

Instead of blindly scraping everything every 5 minutes, the bot will follow a **two-phase approach**:

**Phase 1 - Scout (cheap):** One API call per sport to check what games exist today. This costs ~4-5 calls total.

**Phase 2 - Pull Odds (targeted):** Only fetch player prop markets for sports/events that actually have games, and only for the prop types the bot cares about most.

## Budget Breakdown (per day)

| Activity | Frequency | Calls/Run | Daily Total |
|---|---|---|---|
| Scouting (events check) | Every 30 min (48x) | 5 calls | 240 |
| Full player prop scrape | 3x/day (9AM, 12PM, 5PM ET) | ~120 calls | 360 |
| Team props (spreads/totals/ML) | 3x/day | ~20 calls | 60 |
| Pre-generation refresh | 1x before bot runs | ~80 calls | 80 |
| Line movement checks | Every 15 min for active picks | ~10 calls | 960 |

**Estimated daily usage: ~1,700 calls/day** (down from 47,500)

At 1,700/day, 100K lasts **~59 days** (about 2 months).

## What Changes

### 1. Add API Budget Tracker (new database table)

Track daily API usage so the bot knows when to slow down or stop:
- `api_budget_tracker` table with daily call counts and remaining quota
- Hard ceiling: if daily calls exceed 2,500, pause all scraping until next day
- Warning threshold at 2,000 calls

### 2. Rewrite Scraper Scheduling Logic

Replace the "scrape everything every 5 minutes" approach with smart tiers:

- **Scouting mode** (every 30 min): Only fetch events endpoints (1 call per sport) to know what games exist. No player props.
- **Full scrape** (3x/day at 9AM, 12PM, 5PM ET): Pull all player props and team props for today's games only. Focus on NBA + NHL (where the bot has the best data).
- **Targeted refresh** (every 15 min, active picks only): Only re-fetch odds for players already in `category_sweet_spots` with pending outcomes -- typically 20-40 players, not hundreds.

### 3. Sport Priority System

Not all sports deserve equal API spend. Rank by bot performance:

- **Tier 1 (always fetch):** NBA, NHL -- best historical data, most profitable
- **Tier 2 (fetch if games exist):** NCAAB, WNBA (when in season)
- **Tier 3 (skip for now):** NFL/NCAAF (offseason), Tennis (low volume)

This alone cuts API calls by ~60% since tennis tournaments and football add ~8 sports with 0 games right now.

### 4. Dedup Market Requests

Currently the scraper fetches each market separately (6 calls per NBA event). Batch multiple markets into a single API call where The Odds API supports it (comma-separated markets parameter). This cuts player prop calls from 6 per event to 2-3.

### 5. Pre-Generation Refresh Gate

Before `bot-generate-daily-parlays` runs, trigger a targeted odds refresh ONLY for the players/props in today's `category_sweet_spots`. This ensures the bot has fresh lines without scraping the entire market.

## Technical Details

### New table: `api_budget_tracker`

```sql
CREATE TABLE api_budget_tracker (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE,
  calls_used INTEGER DEFAULT 0,
  calls_limit INTEGER DEFAULT 2500,
  last_full_scrape TIMESTAMPTZ,
  last_scout TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### File: `supabase/functions/whale-odds-scraper/index.ts`

Major changes:
- Add `mode` parameter: `'scout'` (events only), `'full'` (all props), `'targeted'` (active picks only)
- In scout mode: only call events endpoints, store game counts, cost ~5 API calls
- In full mode: batch markets where possible, only fetch Tier 1+2 sports with active games
- In targeted mode: only fetch odds for players in today's `category_sweet_spots`
- Before every API call, increment `api_budget_tracker` and check against daily limit
- Skip sports with 0 upcoming events (saves ~60% of current calls)

### File: `supabase/functions/data-pipeline-orchestrator/index.ts`

- Before calling `whale-odds-scraper` in full mode, check `api_budget_tracker` for remaining budget
- Call scraper in `'targeted'` mode before parlay generation instead of full mode
- Log API budget status in pipeline results

### Cron Schedule Changes

Replace the current 5-minute cron with:
- Every 30 minutes: `whale-odds-scraper` in `scout` mode
- 3x daily (9AM, 12PM, 5PM ET): `whale-odds-scraper` in `full` mode
- Before bot generation: `whale-odds-scraper` in `targeted` mode

## Summary

| Metric | Before | After |
|---|---|---|
| Daily API calls | ~47,500 | ~1,700 |
| 100K lasts | ~2 days | ~59 days |
| Sports scraped | 14 (incl. offseason) | 2-4 (active only) |
| Calls per event | 6-7 separate | 2-3 batched |
| Refresh frequency | Every 5 min (everything) | Smart tiers (scout/full/targeted) |

