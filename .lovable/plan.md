

# Fix Missing Whale Proxy Signals: Populate Unified Props

## Problem Root Cause

The whale detector is working but generates 0 signals because `unified_props` table is empty. The system needs both:
1. PrizePicks lines (pp_snapshot) - Working
2. Sportsbook lines (unified_props) - EMPTY

## Solution Overview

Add the `unified_props` scraper (odds API) to the cron job cycle so sportsbook data gets populated alongside PrizePicks data.

---

## Step 1: Check Existing Odds Scraper

First, verify if a `refresh-todays-props` or similar edge function exists that populates `unified_props`.

---

## Step 2: Add Odds Scraper to Cron Jobs

If the function exists, schedule it to run every 5 minutes alongside the other whale proxy jobs:

```sql
SELECT cron.schedule(
  'whale-odds-scraper-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/refresh-todays-props',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer [ANON_KEY]"}'::jsonb,
    body := '{"sports": ["basketball_nba", "hockey_nhl", "tennis_atp", "tennis_wta"]}'::jsonb
  ) AS request_id;
  $$
);
```

---

## Step 3: Chain Order for Data Flow

Adjust cron timing so data flows correctly:

| Minute | Job | Purpose |
|--------|-----|---------|
| :00 | `odds-scraper` | Fetch sportsbook lines into `unified_props` |
| :01 | `pp-props-scraper` | Fetch PrizePicks lines into `pp_snapshot` |
| :02 | `whale-signal-detector` | Compare PP vs Books, generate signals |

Or run all three in a single orchestrated call via `data-pipeline-orchestrator`.

---

## Step 4: Alternative - Mock Data for Testing

If no odds API key is configured, we can temporarily insert test data into `unified_props` to verify the detector works:

```sql
INSERT INTO unified_props (player_name, prop_type, current_line, sport, bookmaker, game_description, commence_time, is_active)
VALUES 
  ('Luka Dončić', 'player_points', 31.5, 'basketball_nba', 'fanduel', 'DAL vs GSW', NOW() + INTERVAL '2 hours', true),
  ('Stephen Curry', 'player_assists', 7.5, 'basketball_nba', 'draftkings', 'GSW vs DAL', NOW() + INTERVAL '2 hours', true);
```

This would create a 2-point divergence (PP has 29.5, book has 31.5) for Luka, which should generate a signal.

---

## Files to Modify

| File | Change |
|------|--------|
| Check `supabase/functions/` | Find odds API scraper function |
| SQL (cron.schedule) | Add odds scraper to 5-minute cron cycle |
| (Optional) SQL INSERT | Mock data for immediate testing |

---

## Expected Result

After implementation:
1. `unified_props` gets populated with sportsbook lines every 5 minutes
2. Whale detector finds divergences between PP and book lines
3. Signals appear on the dashboard with proper grades (A/B/C)
4. Tennis signals will work once ATP/WTA odds are available from the API

