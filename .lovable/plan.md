

## Per-Customer Bankroll + Individualized Stake Sizing

### Problem
All customers see the same flat stakes ($250 execution, $125 validation, etc.) regardless of their personal bankroll. A customer with $5,000 should be staking more than one with $500. The bot also doesn't track per-customer bankroll over time.

### Plan

#### 1. Database Migration
- Add `bankroll NUMERIC DEFAULT 500` to `bot_authorized_users` — each customer's current bankroll
- Add `bankroll NUMERIC DEFAULT 0` to `customer_daily_pnl` — daily snapshot of running bankroll
- Add unique constraint on `customer_daily_pnl(chat_id, pnl_date)` for upsert support

#### 2. `/bankroll` Telegram Command (telegram-webhook)
- New command for all users: `/bankroll [amount]`
- Sets their `bot_authorized_users.bankroll` if amount provided
- Shows current bankroll if no amount given
- Admin's `/bankroll` also syncs to `bot_activation_status.simulated_bankroll`

#### 3. Personalized Stake in Telegram Broadcasts (bot-send-telegram)
When broadcasting parlays to customers, for each customer:
- Look up their `bankroll` from `bot_authorized_users`
- Calculate personalized stake as percentage of their bankroll per tier:
  - Execution: 5% of bankroll
  - Validation: 2.5% of bankroll  
  - Exploration: 1% of bankroll
  - Lottery: 0.5% of bankroll
- Append `💰 Your stake: $X` line to each customer's broadcast (personalized per customer, not same message to all)

#### 4. Settlement Populates Per-Customer P&L + Bankroll Rollover (bot-settle-and-learn)
After updating `bot_activation_status`, loop through all active customers:
- For each customer: scale their daily P&L proportional to `customer_stake / bot_simulated_stake`
- Update `bot_authorized_users.bankroll` with rolling total
- Upsert into `customer_daily_pnl` with `bankroll` snapshot

#### 5. Dynamic Admin Bankroll Floor (bot-settle-and-learn)
- Replace hardcoded `BANKROLL_FLOOR = 2000` with a lookup from `user_bankroll` for the admin, so when you change bankroll in the UI it's respected by the bot

#### 6. Show Bankroll in `/calendar` and `/roi` (telegram-webhook)
- Include running bankroll in customer command output

### Files to Change
1. **Migration SQL** — alter `bot_authorized_users` + `customer_daily_pnl`
2. **`supabase/functions/telegram-webhook/index.ts`** — `/bankroll` command, updated `/calendar` + `/roi`
3. **`supabase/functions/bot-settle-and-learn/index.ts`** — per-customer P&L scaling, bankroll rollover, dynamic floor
4. **`supabase/functions/bot-send-telegram/index.ts`** — personalized stake lines per customer in broadcasts
5. **`src/hooks/useBankroll.ts`** — sync admin bankroll to `bot_activation_status`

