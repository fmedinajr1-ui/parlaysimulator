

# Maximize Props Collection: 500+ Active Picks

## Current State Analysis

| Data Source | Current Active | Target | Gap |
|-------------|----------------|--------|-----|
| NBA Player Props | 169 | 250+ | +81 |
| NHL Player Props | 0 | 100+ | +100 |
| Tennis Player Props (ATP/WTA) | 0 | 50+ | +50 |
| Team Bets (All Sports) | 21 | 100+ | +79 |
| **Total** | **190** | **500+** | **+310** |

### Root Cause

The current `whale-odds-scraper-5min` cron job is misconfigured:
- It calls `refresh-todays-props` instead of `whale-odds-scraper`
- Only includes `basketball_nba` and `hockey_nhl`
- Missing all Tennis markets (ATP/WTA tournaments)

---

## Implementation Plan

### Phase 1: Fix Cron Job Configuration

Replace the existing cron job to call the correct function with all sports:

**Delete old job and create new one:**
```sql
-- Remove misconfigured job
SELECT cron.unschedule('whale-odds-scraper-5min');

-- Create corrected job calling whale-odds-scraper with ALL sports
SELECT cron.schedule(
  'whale-odds-scraper-5min',
  '*/5 * * * *',  -- Every 5 minutes
  $$
  SELECT net.http_post(
    url := 'https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/whale-odds-scraper',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer ..."}'::jsonb,
    body := '{
      "sports": [
        "basketball_nba",
        "basketball_wnba", 
        "icehockey_nhl",
        "tennis_atp_australian_open",
        "tennis_wta_australian_open",
        "americanfootball_nfl",
        "basketball_ncaab"
      ],
      "limit_events": 15,
      "include_player_props": true,
      "include_team_props": true
    }'::jsonb
  ) AS request_id;
  $$
);
```

### Phase 2: Increase Event Limits

Update the `whale-odds-scraper` edge function to fetch more events per sport:

| Parameter | Current | New | Impact |
|-----------|---------|-----|--------|
| `limit_events` | 10 | 15 | +50% more games |
| Time window | 48 hours | 72 hours | Captures more upcoming events |

### Phase 3: Add Dynamic Sport Selection

Enhance the scraper to automatically detect which sports have active games:

```typescript
// Dynamic sport detection based on season
function getActiveSports(): string[] {
  const month = new Date().getMonth();
  const sports = ['basketball_nba']; // Always active
  
  // NHL: October - June
  if (month >= 9 || month <= 5) sports.push('icehockey_nhl');
  
  // Tennis Grand Slams (check current dates)
  // Australian Open: Jan, French Open: May-Jun, Wimbledon: Jun-Jul, US Open: Aug-Sep
  if (month === 0 || month === 1) {
    sports.push('tennis_atp_australian_open', 'tennis_wta_australian_open');
  }
  
  return sports;
}
```

### Phase 4: Trigger Immediate Scrape

After updating cron, run an immediate full scrape to populate the pool:

```typescript
// Call with maximum coverage
await supabase.functions.invoke('whale-odds-scraper', {
  body: {
    sports: ['basketball_nba', 'icehockey_nhl', 'tennis_atp_australian_open', ...],
    limit_events: 20,
    include_player_props: true,
    include_team_props: true
  }
});
```

---

## Expected Pool Size After Implementation

| Sport | Events/Day | Props/Event | Bookmakers | Total Props |
|-------|------------|-------------|------------|-------------|
| NBA | 8-12 | 6 markets × 15 players | 4 | ~360 |
| NHL | 6-10 | 5 markets × 12 players | 4 | ~240 |
| Tennis | 4-8 | 3 markets × 2 players | 4 | ~48 |
| Team Bets | 20+ | 3 bet types | 4 | ~240 |
| **Total** | | | | **~888 props** |

After deduplication: **500-600 unique active picks**

---

## Technical Changes

### Files to Modify

1. **SQL Execution** - Update cron job configuration
2. **`supabase/functions/whale-odds-scraper/index.ts`** - Increase limits and add dynamic sport detection

### Verification Steps

1. Check `cron.job` table confirms new schedule
2. Run immediate scrape and verify prop counts
3. Monitor `unified_props` table for multi-sport data
4. Verify `game_bets` table has spreads/totals for all sports

---

## Timeline

| Step | Action | Duration |
|------|--------|----------|
| 1 | Update cron job SQL | Immediate |
| 2 | Modify whale-odds-scraper limits | 5 min |
| 3 | Trigger immediate full scrape | 2 min |
| 4 | Verify 500+ props active | 5 min |

**Total: ~15 minutes to full 500+ prop pool**

