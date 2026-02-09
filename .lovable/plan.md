

# Fix: Availability Gate + Daily Injury Scraping

## Problems Found

1. **Availability gate was never implemented** - the functions `fetchActivePlayersToday`, `fetchInjuryBlocklist`, and `getEasternDateRange` do not exist in `bot-generate-daily-parlays/index.ts`. Sweet spots are passed through unfiltered.

2. **Players out for the season are in parlays** - Collin Gillespie, Klay Thompson (traded/injured), Joel Embiid (OUT), Kawhi Leonard (OUT), Jimmy Butler III (suspended/traded) all appear in today's generated parlays.

3. **Lineup scraper has no cron job** - `firecrawl-lineup-scraper` is not scheduled, so `lineup_alerts` data stops at Feb 8. The bot has zero injury data for today.

4. **`unified_props` query is unbounded** - still uses `>= NOW()` which pulls tomorrow's games into today's pool.

## Solution

### Part 1: Actually implement the 3-Layer Availability Gate in `bot-generate-daily-parlays/index.ts`

Add three functions and integrate them into `buildPropPool()`:

**`getEasternDateRange()`** - Returns UTC timestamps for today's ET noon-to-noon window (matching how sportsbooks slate games):
- Start: today 12:00 PM ET as UTC
- End: tomorrow 12:00 PM ET as UTC

**`fetchActivePlayersToday()`** - Queries `unified_props` with the bounded ET window and returns a `Set<string>` of player names with active lines today.

**`fetchInjuryBlocklist()`** - Queries `lineup_alerts` for today's game date:
- Returns blocklist (OUT, DOUBTFUL players)
- Returns penalty map (GTD = 0.7x weight, QUESTIONABLE = 0.85x)

**Filter integration** - After fetching sweet spots, filter them:
- Remove any player NOT in `activePlayersToday` set
- Remove any player in the injury blocklist
- Apply weight penalties for GTD/QUESTIONABLE players
- Log all filtered-out players for debugging

Also fix the `unified_props` query in the fallback path to use the bounded date window instead of `>= NOW()`.

### Part 2: Schedule daily injury scraping via cron

Add a cron job for `firecrawl-lineup-scraper` to run twice daily:
- 8:00 AM ET (early morning injury reports)
- 4:00 PM ET (pre-game injury updates)

This ensures `lineup_alerts` has fresh data when the bot generates parlays at 9 AM ET and for afternoon refreshes.

SQL migration:
```text
SELECT cron.schedule(
  'lineup-scraper-morning', '0 13 * * *',  -- 8 AM ET = 13:00 UTC
  net.http_post(firecrawl-lineup-scraper)
);
SELECT cron.schedule(
  'lineup-scraper-afternoon', '0 21 * * *',  -- 4 PM ET = 21:00 UTC
  net.http_post(firecrawl-lineup-scraper)
);
```

### Part 3: Trigger an immediate injury scrape

After deploying, invoke `firecrawl-lineup-scraper` to populate today's `lineup_alerts` so the availability gate has injury data to work with.

## Technical Details

### Changes to `supabase/functions/bot-generate-daily-parlays/index.ts`

**Add before `buildPropPool`:**
```text
function getEasternDateRange() {
  // Calculate today's ET date, then create noon-to-noon UTC window
  // ET is UTC-5 (EST) or UTC-4 (EDT)
  // Noon ET = 17:00 UTC (EST) or 16:00 UTC (EDT)
}

async function fetchActivePlayersToday(supabase, startUtc, endUtc) {
  // Query unified_props WHERE commence_time BETWEEN start AND end
  // Return Set<string> of lowercase player names
}

async function fetchInjuryBlocklist(supabase, gameDate) {
  // Query lineup_alerts WHERE game_date = gameDate
  // Return { blocklist: Set<string>, penalties: Map<string, number> }
}
```

**Modify `buildPropPool`:**
```text
1. Call getEasternDateRange() at the top
2. Call fetchActivePlayersToday() 
3. Call fetchInjuryBlocklist()
4. After enriching sweet spots, filter:
   - Remove players NOT in activePlayersToday
   - Remove players in blocklist
   - Apply weight penalties from penalties map
5. Fix unified_props query: replace >= NOW() with BETWEEN start/end
6. Log: "Active players: X, Blocked: Y, Filtered sweet spots: Z -> W"
```

### Database Migration (cron jobs)

Schedule `firecrawl-lineup-scraper` to run at 8 AM and 4 PM ET daily.

## Expected Outcome

- Only players with active game-day lines appear in parlays
- OUT/DOUBTFUL players (Embiid, Kawhi, etc.) are automatically blocked
- Season-out players (Gillespie, etc.) are excluded since they have no lines
- Fresh injury data is scraped twice daily before parlay generation windows

