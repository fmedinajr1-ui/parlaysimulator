
# Verification Report + Cleanup Plan

## What the Test Revealed

### Run History Today

| Time (UTC) | Run | Execution NCAAB Legs | Status |
|---|---|---|---|
| 10:03 | Pre-fix | 0 NCAAB legs | Pure NBA only |
| 12:00 | Pre-fix | 0 NCAAB legs | Pure NBA only |
| 13:02 | Pre-fix (before new deploy) | 2 NCAAB SPREAD legs in execution | BAD — old code |
| 14:55 | After new deploy | Pool = 1, 0 generated | Code is clean |

### The Code Fix Is Working

The 14:55 UTC run log confirms:
- `"Blocked NCAAB player props"` — player prop block active
- ML Sniper log: `"NCAAB OVER total BLOCKED (31% hit rate)"` — overs blocked
- NCAAB under totals with composite < 40% also correctly blocked by dynamic floor
- NCAAB unders that clear the floor (Furman UNDER composite 93, Georgetown UNDER composite 62) are sitting in the game_bets pool, ready to be used when the parlay pool is large enough

### NCAAB Unders Available Tonight

The following NCAAB under totals are live in the system today (games tip tonight):

| Matchup | Bet Type | Side | Composite | Sharp Score |
|---|---|---|---|---|
| Furman vs East Tennessee St | total | UNDER | 93 | 65 |
| Holy Cross vs Lafayette | total | UNDER | 73 | 50 |
| Georgetown vs Butler | total | UNDER | 62 | 50 |
| Penn State vs Rutgers | total | UNDER | 60 | 55 |

These are exactly the NCAAB unders profile targets — they will enter the `ncaab_unders_only` execution profile when NBA player prop pool expands.

### The One Remaining Problem

Two execution-tier parlays from the 13:02 run (created before the fix deployed) still have NCAAB **spread** legs:
- `James Madison @ Coastal Carolina — SPREAD, side: home` — should never be in execution
- `East Tennessee St @ Furman Paladins — SPREAD, side: home` — should never be in execution

These are stale pre-fix data. They need to be deleted.

### Why There Are No 3-Leg NBA Parlays Yet

The NBA is completely dark today — no games, only 1 player prop in the pool (minimum is 12). The 3-leg NBA execution profiles and NCAAB unders profiles will activate Thursday when the NBA slate returns. Today's parlays are all from the mini-parlay fallback running on a thin prop pool.

## The Fix Plan

### Action 1 — Delete the 2 stale NCAAB spread execution parlays (SQL migration)

Delete the 2 execution-tier parlays from 13:02 UTC that contain NCAAB spread legs — these were created before the fix deployed and are the only remaining bad data:

```sql
DELETE FROM bot_daily_parlays
WHERE parlay_date = CURRENT_DATE
  AND tier = 'execution'
  AND created_at >= '2026-02-18 13:00:00+00'
  AND created_at < '2026-02-18 13:10:00+00'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements(legs) AS leg
    WHERE leg->>'sport' = 'basketball_ncaab'
      AND leg->>'prop_type' = 'spread'
  );
```

This is a targeted surgical delete — only removes parlays that have NCAAB spread legs in the 13:02 batch.

### Action 2 — Also clean up all pre-fix execution mini-parlays from 10:03 and 12:00 that are 2-leg combos

The 10:03 and 12:00 runs also produced 2-leg execution mini-parlays (cap should now be 0). These are all pure NBA but still violate the new rule that execution tier never gets 2-leg mini-parlays:

```sql
DELETE FROM bot_daily_parlays
WHERE parlay_date = CURRENT_DATE
  AND tier = 'execution'
  AND leg_count = 2
  AND strategy_name = 'premium_boost_execution_mini_parlay';
```

This removes all 9 execution-tier 2-leg mini-parlays regardless of sport, since the new rule is zero 2-leg minis in execution.

## Expected State After Cleanup

| Tier | Parlays Remaining | Leg Count | Strategy |
|---|---|---|---|
| execution | 0 (all deleted, fresh start for Thursday) | — | — |
| validation | 15 | 2-leg | mini_parlay at $50 |
| exploration | 29 | 2-3 leg | mixed at $20-25 |

Thursday's NBA game night will be the real end-to-end test:
- 3-leg NBA execution parlays using Embiid (84% hit rate), THREE_POINT_SHOOTER (96%) 
- NCAAB unders execution parlays using tonight's Furman UNDER (composite 93), Georgetown UNDER (composite 62)
- Zero 2-leg mini-parlays in execution tier

## Files to Change

One SQL migration only — no code changes needed. The code fix is already deployed and verified working.
