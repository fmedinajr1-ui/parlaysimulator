
# Standardize $10 Stake and Show Voided Legs

## What Changes

### 1. Set all parlay stakes to $10
Every parlay the bot generates will use a flat **$10 simulated stake**, regardless of tier (exploration, validation, or execution). This replaces the current mix of $0 (exploration), $50 (validation), and Kelly-calculated stakes.

### 2. Show "VOIDED" on legs with no score
Legs like "Nikola Vucevic Assists O 2.5" that have no actual value and no outcome will display a "VOIDED" label instead of appearing as pending/unknown.

### 3. Backfill existing data
All existing parlays with stake of $0 or $50 will be updated to $10, and P&L will be recalculated proportionally.

---

## Technical Details

### File: `supabase/functions/bot-generate-daily-parlays/index.ts`
- Change exploration tier `stake: 0` to `stake: 10` (line 61)
- Change validation tier `stake: 50` to `stake: 10` (line 133)
- Change execution tier stake to `stake: 10` (remove Kelly calculation)
- Change fallback on line 1690 from `config.stake || 50` to `config.stake || 10`

### File: `supabase/functions/bot-settle-and-learn/index.ts`
- Change all `parlay.simulated_stake || 50` fallbacks to `parlay.simulated_stake || 10` (lines 424, 425, 429, 454)

### File: `src/components/bot/BotParlayCard.tsx`
- Change `parlay.simulated_stake || 50` to `parlay.simulated_stake || 10` (lines 89, 94)

### File: `src/hooks/useBotEngine.ts`
- Change `SIMULATED_STAKE: 50` to `SIMULATED_STAKE: 10` (line 167)

### File: `src/components/bot/DayParlayDetail.tsx`
- In the leg rendering section (lines 172-189), add logic: if the parlay outcome is `void` or the leg has no outcome and no `actual_value`, show a "VOIDED" badge/icon instead of the pending clock icon
- Add a muted "VOIDED" text label next to the leg description

### Database Backfill (migration)
```sql
-- Update all parlays to $10 stake
UPDATE bot_daily_parlays
SET simulated_stake = 10
WHERE simulated_stake IS NULL OR simulated_stake != 10;

-- Recalculate P&L for won parlays (scale proportionally)
-- For won parlays that had stake=0 but got settled with implicit $50:
-- New profit = old_profit * (10 / 50)
UPDATE bot_daily_parlays
SET profit_loss = profit_loss * (10.0 / 50.0),
    simulated_payout = simulated_payout * (10.0 / 50.0)
WHERE outcome = 'won'
  AND (simulated_stake IS NULL OR simulated_stake = 0 OR simulated_stake = 50)
  AND profit_loss IS NOT NULL
  AND profit_loss != 0;

-- For lost parlays, loss = -$10
UPDATE bot_daily_parlays
SET profit_loss = -10
WHERE outcome = 'lost'
  AND profit_loss IS NOT NULL;

-- Recalculate bot_activation_status daily totals from corrected parlays
-- (Will need to recompute daily_profit_loss, parlays_won, parlays_lost, simulated_bankroll)
```

After the backfill, Feb 9's net P&L will be recalculated based on the $10 stake: 13 wins with scaled payouts minus 10 losses at $10 each.
