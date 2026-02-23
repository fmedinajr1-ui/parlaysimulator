-- Step 1: Delete all lost parlays containing NCAAB legs
DELETE FROM bot_daily_parlays
WHERE outcome = 'lost'
  AND legs::text ILIKE '%ncaab%';

-- Step 2: Recalculate bot_activation_status for affected dates
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