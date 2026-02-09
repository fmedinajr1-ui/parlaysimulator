

# Fix: Bot Player Availability Validation

## Problem

The bot's parlay generator has **zero player availability checking**. It pulls picks from `category_sweet_spots` and `unified_props` without verifying:

1. **The player's team is actually playing today** -- Haliburton (Pacers) and Tatum (Celtics) have no game today (next NBA games are Feb 10)
2. **The player isn't injured/OUT** -- Tatum has been OUT in recent games per `lineup_alerts`
3. **The commence_time filter is too broad** -- `unified_props` query uses `>= NOW()` which pulls ALL future games, not just today's

## Root Causes

```text
+-----------------------------------+------------------------------------------+
| Data Source                       | Missing Filter                           |
+-----------------------------------+------------------------------------------+
| category_sweet_spots              | No game-day validation at all            |
|   (analysis_date filter only)     | Picks generated for ALL known players    |
+-----------------------------------+------------------------------------------+
| unified_props (fallback)          | commence_time >= NOW() pulls tomorrow+   |
|                                   | No injury status check                   |
+-----------------------------------+------------------------------------------+
| lineup_alerts                     | Never consulted during parlay generation |
+-----------------------------------+------------------------------------------+
```

## Solution: 3-Layer Availability Gate

Add three filters to `buildPropPool()` in `bot-generate-daily-parlays`:

### Layer 1: Active Game Verification
- Query `unified_props` for today's games only (commence_time between today start and end)
- Build a Set of player names who actually have lines posted today
- Only include sweet spot picks whose `player_name` exists in the active player set

### Layer 2: Injury/Lineup Cross-Reference
- Query `lineup_alerts` for today's date
- Build a blocklist of players with status `OUT` or `DOUBTFUL`
- Remove any blocked players from the candidate pool
- Log warnings for `GTD` / `QUESTIONABLE` players (reduce weight but don't block)

### Layer 3: Tighten commence_time Window
- Change `unified_props` query from `>= NOW()` to a proper date window (today only in ET)
- This prevents pulling tomorrow's props into today's parlays

## Technical Changes

### Modified File: `supabase/functions/bot-generate-daily-parlays/index.ts`

**In `buildPropPool()` function:**

1. Add ET date calculation for proper game-day windowing
2. Query `unified_props` with a bounded date range (today only)
3. Build `activePlayersToday` Set from unified_props player names
4. Query `lineup_alerts` for today to get injury blocklist
5. Filter `category_sweet_spots` results: only keep players in `activePlayersToday` AND not in injury blocklist
6. Apply injury weight penalties: GTD players get 0.7x weight, QUESTIONABLE get 0.85x
7. Log filtered-out players for debugging

**Key code additions:**

```text
1. getEasternDateRange() -- returns today's start/end timestamps in UTC
2. fetchActivePlayersToday() -- queries unified_props for today's window
3. fetchInjuryBlocklist() -- queries lineup_alerts for OUT/DOUBTFUL
4. Filter sweet spots against both sets before enrichment
5. Add availability metadata to leg data (injury_status field)
```

### Expected Logging Output
```text
[Bot] Active players today: 85 (from 6 NBA games)
[Bot] Injury blocklist: 4 players (OUT: 3, DOUBTFUL: 1)
[Bot] Filtered sweet spots: 120 -> 72 (removed 48 players not playing today)
[Bot] GTD weight penalties applied to 2 players
```

## Expected Outcome

- Players without a game today are completely excluded
- OUT/DOUBTFUL players are blocked from all parlays
- GTD players are penalized but not blocked (allows late-scratch handling)
- The bot only generates parlays with players who are confirmed active for today's slate

