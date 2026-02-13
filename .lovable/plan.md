
# Fix: Game Log Backfill Missing Most Players

## Root Cause

The `backfill-player-stats` function is only capturing a fraction of NBA games. On Feb 12, it ingested just **3 of ~8+ games** (70 players), completely missing stars like Jokic, Wembanyama, SGA, Luka, KAT, and Anthony Edwards. This caused `verify-sweet-spot-outcomes` to mark **247 of 300 picks as `no_data`** instead of grading them.

Two bugs in `backfill-player-stats/index.ts` cause this:

1. **Line 49: `event.status?.type?.completed !== true`** -- The ESPN scoreboard API requires the game to be marked "completed" at the moment of fetch. If the backfill runs while games are still in progress (or shortly after, before ESPN updates), those games are permanently skipped. Later backfill runs won't revisit them because ESPN may return a different scoreboard state.

2. **ESPN scoreboard pagination** -- The ESPN API endpoint `/scoreboard?dates=YYYYMMDD` sometimes omits late-night games (West Coast tip-offs finishing after midnight ET) or returns a partial list. The function does not verify game count against known schedule data.

## Fix Plan

### Change 1: Remove the `completed` gate and handle in-progress gracefully

In `backfill-player-stats/index.ts`, change the game filter from requiring `completed === true` to accepting any game that has boxscore data available. ESPN boxscores contain stats even for in-progress games. We still skip games that are truly "scheduled" (not started).

```
Before (line 49):
  if (event.status?.type?.completed !== true) continue;

After:
  const state = event.status?.type?.state;
  if (state === 'pre') continue; // Skip games that haven't started
  // Accept 'in' (in-progress) and 'post' (completed) games
```

This ensures late-finishing games are captured on the next cron cycle even if they weren't "completed" during the first run.

### Change 2: Add a retry pass for missed dates

After the primary ESPN fetch, add a secondary check: query `category_sweet_spots` for `no_data` picks whose players are still missing from `nba_player_game_logs`. For each missing player's game date, re-fetch that date's ESPN scoreboard. This acts as a self-healing mechanism.

### Change 3: Use ESPN summary endpoint directly for missing games

When the scoreboard returns fewer games than expected, fall back to fetching individual game summaries by looking up event IDs from `live_game_scores` or the schedule endpoint. This ensures West Coast late games are never permanently lost.

### Change 4: Fix verify-sweet-spot-outcomes retry behavior

Currently, the 13:01 cron run re-graded already-settled picks as `no_data` (overwriting the 11:00 run's correct results). This is because the query on line 144 includes `no_data` in its filter -- it re-processes picks that were already marked `no_data` by a previous run, but if the game logs haven't been updated since, it just re-marks them `no_data` again.

Add a guard: skip picks that were already settled with an `actual_value` set, regardless of their `outcome` field. This prevents the second cron run from overwriting valid settlements.

```
Before (line 144):
  .in('outcome', ['pending', 'no_data']);

After:
  .in('outcome', ['pending', 'no_data'])
  .is('actual_value', null);
```

This ensures that once a pick has been verified with real data, subsequent runs won't regress it.

## Files Modified

1. `supabase/functions/backfill-player-stats/index.ts` -- Remove `completed` gate, add retry for missed dates, fall back to direct game summary fetches
2. `supabase/functions/verify-sweet-spot-outcomes/index.ts` -- Add `actual_value is null` guard to prevent overwriting settled picks

## Expected Impact

- Game log coverage should jump from ~70 players/day to **200-300+ players/day** (full slate)
- `no_data` rate should drop from **82%** (247/300) to under **5%** (only DNP players)
- Settlement accuracy for player props will become reliable, correctly grading Clingan, Kuzma, AJ Green and all other picks
