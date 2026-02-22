

## Speed Up Hedge Opportunity Detection

### The Problem
Live sportsbook lines move in seconds. The current pipeline has multiple layers of delay:

1. **Live odds polling: 30 seconds** -- Lines can shift 2-3 points in that window
2. **Cache TTL: 25 seconds** -- Even if you refresh, stale data is served
3. **Sequential batching: 5 at a time** -- With 10 props, that's 2 serial rounds of API calls
4. **Individual API calls per player** -- Each prop triggers a separate edge function call, which triggers a separate Odds API call
5. **Unified feed: 15 seconds** -- Projections update every 15s, which is fine, but lines need to be faster

### The Fix

#### 1. New Batch Edge Function: `fetch-batch-odds`
Instead of calling `fetch-current-odds` once per player (N calls to edge function, N calls to Odds API), create a single batch endpoint that:
- Accepts an array of `{ player_name, prop_type }` objects
- Makes ONE call to the Odds API per event (not per player)
- Parses all player lines from that single response
- Returns all odds in one response

This alone cuts the round-trip from ~N seconds to ~1 second.

#### 2. Faster Polling in `useLiveSweetSpotLines`
- Drop interval from **30s to 10s** during live games
- Drop cache TTL from **25s to 8s**
- Increase concurrent batch size from **5 to 10** (as fallback if batch endpoint fails)
- Add a `turboMode` flag that kicks in when any hedge alert is active (drops to 6s)

#### 3. Faster Unified Feed Refresh
- When hedge opportunities exist, drop `useUnifiedLiveFeed` refresh from **15s to 8s** so projections keep pace with the faster line updates

#### 4. Optimistic UI Updates
- Show a "refreshing..." pulse on hedge cards while fetching
- Instantly update the timestamp display so you know how fresh the data is
- Add a manual "Refresh Now" button on the hedge slide-in

### File Changes

**New file: `supabase/functions/fetch-batch-odds/index.ts`**
- Accepts `{ event_id, sport, players: [{ player_name, prop_type }], preferred_bookmakers, return_all_books }`
- Makes ONE Odds API call per unique market type
- Returns `{ results: [{ player_name, prop_type, odds, all_odds }] }`
- Reuses the same name normalization and bookmaker priority logic from `fetch-current-odds`

**Modified: `src/hooks/useLiveSweetSpotLines.ts`**
- Replace N individual `fetch-current-odds` calls with a single `fetch-batch-odds` call
- Reduce `intervalMs` default from 30000 to 10000
- Reduce `CACHE_TTL` from 25000 to 8000
- Add `turboMode` option: when true, poll every 6 seconds
- Remove the batch-of-5 sequential loop (no longer needed with batch endpoint)

**Modified: `src/hooks/useSweetSpotLiveData.ts`**
- Pass `turboMode: true` to `useLiveSweetSpotLines` when any spot has hedge status of `alert` or `urgent`
- Reduce `useUnifiedLiveFeed` refresh to 8s when hedge alerts are active

**Modified: `src/components/scout/warroom/HedgeSlideIn.tsx`**
- Add a "Refresh Now" button that triggers an immediate odds refresh
- Add a pulsing dot + seconds-ago counter showing data freshness
- Show "Updating..." state during fetch

**Modified: `src/components/scout/warroom/WarRoomLayout.tsx`**
- Pass `refreshLines` function down to `HedgeSlideIn` for the manual refresh button
- Pass `lastFetchTime` for the freshness indicator

### Speed Comparison

| Metric | Before | After |
|--------|--------|-------|
| Odds polling interval | 30s | 10s (6s turbo) |
| Cache TTL | 25s | 8s |
| API calls per refresh | N (one per player) | 1 (batch) |
| Edge function calls per refresh | N | 1 |
| Projection refresh (with hedge) | 15s | 8s |
| Manual refresh | Not available | One tap |

### Technical: Batch Endpoint Design

```
POST /fetch-batch-odds
{
  "event_id": "abc123",
  "sport": "basketball_nba",
  "players": [
    { "player_name": "LeBron James", "prop_type": "player_points" },
    { "player_name": "Anthony Davis", "prop_type": "player_rebounds" }
  ],
  "preferred_bookmakers": ["hardrockbet", "fanduel", "draftkings"],
  "return_all_books": true
}
```

The function groups players by `prop_type` (market), makes one Odds API call per unique market, then matches all players from that single response. For a typical slate with 3-4 market types, this means 3-4 API calls total instead of 10-15.

### Result
- Lines update **3-5x faster** during live games
- Hedge alerts fire within seconds of a line move, not half a minute later
- One-tap manual refresh for time-critical moments
- Fewer API calls = less chance of hitting rate limits

**5 files modified (1 new edge function, 4 updated). No database changes.**

