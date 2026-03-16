

# War Room Hedge Telegram Tracker — Status & Fix

## Current Status
- **Cron is running** — every 5 minutes, confirmed active (job #106)
- **Function deploys and executes** — no errors in logs
- **Last run** (9:50 AM ET): Found 400 picks, but **sent 0 messages**
- **`hedge_telegram_tracker` table is empty** — no messages have ever been sent

## Why No Messages Are Sending

### Issue 1: Game Hours Gate (Expected)
Pre-game scouts only send when `etHour >= 17` (5 PM ET). It's currently morning, so this is working as designed. Messages will start at 5 PM ET today.

### Issue 2: No Sport Filter (Bug)
The function queries **all 400** unsettled `category_sweet_spots` picks — including **MLB** picks (hits, total_bases, etc.) which have no quarter baselines and no ESPN live feed. The hedge tracker is NBA-focused but doesn't filter by sport. This causes:
- Unnecessary processing of ~300 MLB picks
- Potential timeout (function ran for ~90 seconds before shutdown)
- StatMuse quarter data won't match MLB players

### Issue 3: Potential Timeout Risk
Processing 400 picks + calling `unified-player-feed` + querying baselines for all may exceed the edge function time limit, preventing messages from ever sending even during game hours.

## Fix

### `supabase/functions/hedge-live-telegram-tracker/index.ts`

**Filter picks to NBA only** by checking prop types that are NBA-relevant (points, rebounds, assists, threes, steals, blocks, pra). Add a sport-aware filter right after fetching picks:

```ts
const NBA_PROP_TYPES = ['points', 'rebounds', 'assists', 'threes', 'steals', 'blocks', 'pra',
  'player_points', 'player_rebounds', 'player_assists', 'player_threes', 'player_steals', 'player_blocks'];

const nbaPicks = picks.filter(p => 
  NBA_PROP_TYPES.includes((p.prop_type || '').toLowerCase())
);
```

Then use `nbaPicks` for all downstream processing instead of `picks`. This should reduce from ~400 to ~80-100 picks, well within timeout limits.

### Files to Edit
- `supabase/functions/hedge-live-telegram-tracker/index.ts` — add NBA prop filter after line 107

This single change ensures the function processes only NBA picks (where quarter data and live feeds exist) and avoids timeout issues. The cron and notification types are already wired correctly — once game hours hit today, pre-game scouts will fire.

