

## Bug: `bot_activation_status` Double-Counting P&L

### Evidence

| Source | March 7 Profit |
|--------|---------------|
| `bot_activation_status.daily_profit_loss` | **$1,995** (what Telegram reports) |
| `SUM(profit_loss) FROM bot_daily_parlays` | **$745.75** (actual truth) |
| Inflation | **$1,249.25 overstated** (~2.7x) |

The settlement engine runs multiple times per day via cron. Each run accumulates P&L onto the existing `daily_profit_loss` value (line 1342), but doesn't deduplicate — parlays already settled in a prior run get counted again in the accumulation.

### Fix

**Replace accumulation with source-of-truth recalculation.** Instead of `existingEntry.daily_profit_loss + datePnL.profitLoss`, query the actual sum directly from `bot_daily_parlays` for that date.

**File: `supabase/functions/bot-settle-and-learn/index.ts`** (lines 1319-1394)

For each `dateKey` being processed:

1. Query `bot_daily_parlays` for the **authoritative totals**:
   ```sql
   SELECT 
     COALESCE(SUM(profit_loss), 0) as total_pl,
     COUNT(*) FILTER (WHERE outcome = 'won') as total_won,
     COUNT(*) FILTER (WHERE outcome = 'lost') as total_lost
   FROM bot_daily_parlays
   WHERE parlay_date = dateKey AND outcome IN ('won','lost','push')
   ```

2. Use these totals directly (not accumulated) when writing to `bot_activation_status`:
   - `daily_profit_loss = authoritative total from query`
   - `parlays_won = authoritative won count`
   - `parlays_lost = authoritative lost count`
   - `simulated_bankroll = prevBankroll + authoritative total`

3. This eliminates the double-counting entirely — no matter how many times settlement runs, the activation status always reflects the real parlay-level data.

### Backfill

Run a one-time SQL correction across all dates in `bot_activation_status` to recalculate from `bot_daily_parlays` source of truth. This fixes the historical $1,900 inflation the user saw in Telegram.

### Impact
- Telegram `/performance`, `/calendar`, `/roi` commands all read from `bot_activation_status` — they'll show correct numbers after this fix
- Public stats page (`bot-public-stats`) also reads from this table
- Customer P&L (`customer_daily_pnl`) may also need a similar audit

