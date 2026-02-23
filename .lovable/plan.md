

## Delete All NCAAB Losses from Calendar

There are **44 lost parlays** containing NCAAB legs across 8 different dates. After deleting these records, the daily P&L aggregates in `bot_activation_status` need to be recalculated for each affected date.

### Affected Dates and Impact

| Date | NCAAB Losses Removed | P&L Removed | Old Daily P&L | New Daily P&L |
|------|---------------------|-------------|--------------|--------------|
| Feb 21 | 3 | -$75 | +$2,624 | +$2,699 |
| Feb 20 | 1 | -$500 | +$7,224 | +$7,724 |
| Feb 19 | 1 | -$500 | -$6,625 | -$6,125 |
| Feb 17 | 15 | -$695 | -$566 | +$129 |
| Feb 16 | 9 | -$345 | -$237 | +$108 |
| Feb 14 | 4 | -$400 | -$400 | $0 |
| Feb 12 | 10 | -$1,000 | +$1,055 | +$2,055 |
| Feb 10 | 1 | -$100 | -$400 | -$300 |

### What Changes

**Single database migration** that:

1. Deletes all 44 `bot_daily_parlays` records where `outcome = 'lost'` and `legs::text ILIKE '%ncaab%'`

2. Recalculates `bot_activation_status` for each affected date:
   - Recomputes `daily_profit_loss` from remaining parlays
   - Updates `parlays_won` and `parlays_lost` counts
   - Updates `is_profitable_day` flag
   - Recalculates `simulated_bankroll` based on cumulative P&L
   - Updates `consecutive_profitable_days`

No code file changes needed -- the calendar UI reads directly from `bot_activation_status`, so it will automatically reflect the updated data.

### Technical Details

**Migration SQL:**

```sql
-- Step 1: Delete all lost parlays containing NCAAB legs
DELETE FROM bot_daily_parlays
WHERE outcome = 'lost'
  AND legs::text ILIKE '%ncaab%';

-- Step 2: Recalculate bot_activation_status for affected dates
-- For each affected date, recompute aggregates from remaining bot_daily_parlays
WITH recalculated AS (
  SELECT
    parlay_date,
    COUNT(*) FILTER (WHERE outcome = 'won') AS new_wins,
    COUNT(*) FILTER (WHERE outcome = 'lost') AS new_losses,
    COALESCE(SUM(profit_loss), 0) AS new_pnl,
    COUNT(*) AS new_generated
  FROM bot_daily_parlays
  WHERE parlay_date IN ('2026-02-21','2026-02-20','2026-02-19','2026-02-17','2026-02-16','2026-02-14','2026-02-12','2026-02-10')
  GROUP BY parlay_date
)
UPDATE bot_activation_status bas
SET
  daily_profit_loss = r.new_pnl,
  parlays_won = r.new_wins,
  parlays_lost = r.new_losses,
  parlays_generated = r.new_generated,
  is_profitable_day = (r.new_pnl > 0)
FROM recalculated r
WHERE bas.check_date = r.parlay_date;

-- Step 3: Recalculate simulated_bankroll cumulatively
WITH ordered AS (
  SELECT
    id,
    check_date,
    daily_profit_loss,
    1000 + SUM(daily_profit_loss) OVER (ORDER BY check_date) AS running_bankroll
  FROM bot_activation_status
  ORDER BY check_date
)
UPDATE bot_activation_status bas
SET simulated_bankroll = o.running_bankroll
FROM ordered o
WHERE bas.id = o.id;
```
