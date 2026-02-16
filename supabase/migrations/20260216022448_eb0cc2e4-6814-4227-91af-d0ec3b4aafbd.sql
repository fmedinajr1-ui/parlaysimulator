
-- Scale all historical parlays from $20/$10 stake to $100 (proportional multiplier)
UPDATE bot_daily_parlays 
SET simulated_stake = 100,
    profit_loss = CASE 
      WHEN simulated_stake = 20 THEN profit_loss * 5
      WHEN simulated_stake = 10 THEN profit_loss * 10
      ELSE profit_loss
    END,
    simulated_payout = CASE 
      WHEN simulated_payout IS NOT NULL AND simulated_payout > 0 THEN
        CASE 
          WHEN simulated_stake = 20 THEN simulated_payout * 5
          WHEN simulated_stake = 10 THEN simulated_payout * 10
          ELSE simulated_payout
        END
      ELSE simulated_payout
    END
WHERE simulated_stake = 20 OR simulated_stake = 10;

-- Recalculate daily P&L in activation status (5x for $20 baseline)
UPDATE bot_activation_status 
SET daily_profit_loss = daily_profit_loss * 5,
    simulated_bankroll = 1000 + (simulated_bankroll - 1000) * 5;
