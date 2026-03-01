

## Reconfigure Today's Parlay Stakes to $500

### What This Does
Two changes to ensure $500 stakes across the board:

1. **Update all of today's existing parlays** -- Set `simulated_stake` to 500 and recalculate `simulated_payout` (stake x decimal odds) and `profit_loss` for any already-settled parlays on today's `bot_daily_parlays` records.

2. **Update `bot_stake_config` table** -- Set `execution_stake`, `validation_stake`, and `exploration_stake` all to 500 so any future parlays generated today also use $500.

### Technical Details

**Database migration with two statements:**

```sql
-- 1. Update all today's parlays to $500 stake and recalculate payouts
UPDATE bot_daily_parlays
SET 
  simulated_stake = 500,
  simulated_payout = CASE 
    WHEN outcome = 'won' THEN 500 * (
      CASE WHEN expected_odds > 0 THEN (expected_odds::numeric / 100) + 1 
           ELSE (100.0 / ABS(expected_odds::numeric)) + 1 END
    )
    WHEN outcome = 'lost' THEN 0
    ELSE 500 * (
      CASE WHEN expected_odds > 0 THEN (expected_odds::numeric / 100) + 1 
           ELSE (100.0 / ABS(expected_odds::numeric)) + 1 END
    )
  END,
  profit_loss = CASE
    WHEN outcome = 'won' THEN 500 * (
      CASE WHEN expected_odds > 0 THEN (expected_odds::numeric / 100) + 1 
           ELSE (100.0 / ABS(expected_odds::numeric)) + 1 END
    ) - 500
    WHEN outcome = 'lost' THEN -500
    ELSE profit_loss
  END
WHERE parlay_date = CURRENT_DATE;

-- 2. Update stake config for all future generation today
UPDATE bot_stake_config
SET 
  execution_stake = 500,
  validation_stake = 500,
  exploration_stake = 500,
  updated_at = now();
```

No code file changes needed -- this is purely a data update via migration.

