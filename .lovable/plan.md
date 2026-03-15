

# Automated Quarter Snapshot Capture During Live NBA Games

## Problem
The `quarter_player_snapshots` table only gets populated when a user has the Scout War Room open — the `recordQuarterSnapshot` call lives in the client-side `useScoutAgentState.ts` hook and fires on `isQ1Ending`/`isQ2Ending` etc. No user watching = no snapshots = no live quarter progression data on War Room cards.

## Solution
Create a new edge function `auto-quarter-snapshots` that runs on a cron schedule every 2 minutes during NBA game windows (7 PM–1 AM ET). It will:

1. **Check `live_game_scores`** for NBA games with `game_status = 'in_progress'` 
2. **Detect the current period** from each game's `period` field (Q1/Q2/Q3/Q4)
3. **Track which quarters have already been snapshotted** by querying existing `quarter_player_snapshots` for each event
4. **When a new quarter is detected** (period advanced past what's been captured), fetch player box score stats from ESPN's summary API and upsert into `quarter_player_snapshots`
5. **Also capture at halftime and final** status transitions

### How it works

The function piggybacks on data already flowing through `sync-live-scores`:
- `live_game_scores.period` tells us the current quarter (Q1/Q2/Q3/Q4)
- `live_game_scores.player_stats` already contains per-player box scores from ESPN
- When period transitions from Q1→Q2, we snapshot Q1 stats; Q2→Q3 snapshots Q2, etc.

### Edge function: `supabase/functions/auto-quarter-snapshots/index.ts`

```
1. Query live_game_scores WHERE sport='NBA' AND game_status IN ('in_progress','halftime','final')
2. For each game:
   a. Parse current period number from period field
   b. Query quarter_player_snapshots for this event_id to see which quarters already captured
   c. For any uncaptured quarter < current period:
      - Fetch fresh player stats from ESPN summary API
      - Calculate per-quarter deltas (current cumulative - previous quarter cumulative)
      - Upsert into quarter_player_snapshots
3. Return summary of snapshots created
```

### Key detail: Per-quarter stat isolation
ESPN only provides cumulative box scores. To get Q2-only stats, we subtract Q1 snapshot from Q2 cumulative. The function will:
- Q1: stats as-is (cumulative = Q1 only)
- Q2: current cumulative - Q1 snapshot
- Q3: current cumulative - Q2 cumulative snapshot
- Q4: current cumulative - Q3 cumulative snapshot

### Cron schedule
Run every 2 minutes during NBA game windows. Schedule via `pg_cron`:
```sql
cron.schedule('auto-quarter-snapshots', '*/2 19-23,0 * * *', ...)
```
This covers 7 PM–midnight ET (UTC offset adjusted).

## Changes

| Change | Detail |
|--------|--------|
| New edge function `auto-quarter-snapshots/index.ts` | Detects quarter transitions from `live_game_scores`, fetches ESPN box scores, upserts per-quarter deltas into `quarter_player_snapshots` |
| New cron job | Runs every 2 minutes during NBA game hours |
| No UI changes | Existing War Room polling already reads from `quarter_player_snapshots` |

