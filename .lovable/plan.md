

# Delete 18 Negative-Edge Parlays

## What We're Doing

Removing 18 parlays from today's pool that contain legs where the player's projection contradicts the bet direction (e.g., betting OVER 4.5 assists when projection is only 4.0). This leaves 21 clean parlays with all legs having positive edges.

## Parlays Being Deleted (18)

| Strategy | Negative Legs | Worst Offender |
|----------|:---:|----------------|
| explore_longshot | 6 | Multiple negative buffers |
| max_boost | 5 | Multiple negative buffers |
| premium_boost | 4 | Multiple negative buffers |
| explore_aggressive (x3) | 3, 2, 1 | Mixed negative edges |
| validated_winrate (x2) | 3, 2 | Mixed negative edges |
| explore_longshot | 2 | Negative buffers |
| boosted_cash | 1-2 | Negative buffers |
| ncaab_mixed | 2 | Negative buffers |
| strong_cash_cross | 1 | Single negative leg |
| explore_mixed | 1 | Paolo Banchero AST O4.5 (proj 4.0) |
| validated_standard | 1 | Single negative leg |
| explore_balanced | 1 | Single negative leg |
| validated_cross | 1 | Single negative leg |
| validated_aggressive | 1 | Single negative leg |
| validated_balanced | 1 | Single negative leg |

## Parlays Kept (21 Clean)

All remaining parlays have every leg with `projection_buffer >= 0`, meaning the projection supports the bet direction.

## Technical Details

Single SQL DELETE targeting 18 specific parlay IDs from `bot_daily_parlays` where `parlay_date = '2026-02-11'` and `outcome = 'pending'`.

```sql
DELETE FROM bot_daily_parlays
WHERE parlay_date = '2026-02-11' AND outcome = 'pending'
AND id IN (
  'a65c45d7-...', 'eb0f18b2-...', -- 18 UUIDs
  ...
);
```

No code file changes needed -- this is a one-time data cleanup operation.

