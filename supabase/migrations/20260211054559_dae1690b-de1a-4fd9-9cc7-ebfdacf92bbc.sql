
-- Backfill: Recalculate expected_odds from actual leg american_odds, then fix profit_loss/simulated_payout
-- Step 1: Create a temp function to compute real parlay odds from legs JSON
CREATE OR REPLACE FUNCTION public.backfill_real_parlay_odds() RETURNS void AS $$
DECLARE
  rec RECORD;
  leg RECORD;
  total_decimal_odds NUMERIC;
  leg_odds INTEGER;
  decimal_odd NUMERIC;
  new_expected_odds INTEGER;
  stake NUMERIC;
  payout NUMERIC;
BEGIN
  FOR rec IN SELECT id, legs, outcome, simulated_stake FROM bot_daily_parlays
  LOOP
    total_decimal_odds := 1;
    
    FOR leg IN SELECT * FROM jsonb_array_elements(rec.legs::jsonb)
    LOOP
      leg_odds := COALESCE((leg.value->>'american_odds')::integer, -110);
      IF leg_odds > 0 THEN
        decimal_odd := (leg_odds::numeric / 100) + 1;
      ELSE
        decimal_odd := (100::numeric / ABS(leg_odds)) + 1;
      END IF;
      total_decimal_odds := total_decimal_odds * decimal_odd;
    END LOOP;
    
    -- Convert total decimal odds back to American
    IF total_decimal_odds >= 2 THEN
      new_expected_odds := ROUND((total_decimal_odds - 1) * 100);
    ELSE
      new_expected_odds := ROUND(-100 / (total_decimal_odds - 1));
    END IF;
    
    stake := COALESCE(rec.simulated_stake, 10);
    IF stake = 0 THEN stake := 10; END IF;
    
    IF rec.outcome = 'won' THEN
      payout := stake * total_decimal_odds;
      UPDATE bot_daily_parlays 
      SET expected_odds = new_expected_odds,
          simulated_stake = 10,
          profit_loss = (10 * total_decimal_odds) - 10,
          simulated_payout = 10 * total_decimal_odds
      WHERE id = rec.id;
    ELSIF rec.outcome = 'lost' THEN
      UPDATE bot_daily_parlays 
      SET expected_odds = new_expected_odds,
          simulated_stake = 10,
          profit_loss = -10,
          simulated_payout = 0
      WHERE id = rec.id;
    ELSE
      UPDATE bot_daily_parlays 
      SET expected_odds = new_expected_odds,
          simulated_stake = 10
      WHERE id = rec.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Run the backfill
SELECT public.backfill_real_parlay_odds();

-- Step 3: Drop the temp function
DROP FUNCTION public.backfill_real_parlay_odds();

-- Step 4: Recalculate bot_activation_status daily totals from corrected parlays
UPDATE bot_activation_status bas
SET daily_profit_loss = sub.total_pnl,
    parlays_won = sub.wins,
    parlays_lost = sub.losses
FROM (
  SELECT parlay_date,
    SUM(COALESCE(profit_loss, 0)) as total_pnl,
    COUNT(*) FILTER (WHERE outcome = 'won') as wins,
    COUNT(*) FILTER (WHERE outcome = 'lost') as losses
  FROM bot_daily_parlays
  WHERE outcome IN ('won', 'lost')
  GROUP BY parlay_date
) sub
WHERE bas.check_date = sub.parlay_date;

-- Recalculate simulated_bankroll as running cumulative from $1000 start
WITH running AS (
  SELECT check_date,
    1000 + SUM(COALESCE(daily_profit_loss, 0)) OVER (ORDER BY check_date) as new_bankroll
  FROM bot_activation_status
  WHERE daily_profit_loss IS NOT NULL
)
UPDATE bot_activation_status bas
SET simulated_bankroll = r.new_bankroll
FROM running r
WHERE bas.check_date = r.check_date;
