

## Plan: Customer Stake Plan in Telegram Bot

### What We're Building
A detailed stake plan message shown to customers on first `/start` AND accessible anytime via a new `/plan` command. Uses real performance data: ~28% win rate, +780 avg odds (5.9x return multiplier), to show how a $500 bankroll compounds into profit.

### Changes to `supabase/functions/telegram-webhook/index.ts`

#### 1. New `handleStakePlan()` function
Returns a formatted Telegram message with:

```
🌾 YOUR PROFIT PLAN — $500 Start

📊 Our Engine: 28% Win Rate | +780 Avg Odds
EV per $10 bet: ($10 × 28% × 5.9) - ($10 × 72%) = +$9.32

PHASE 1 — Foundation (Week 1-2)
Stake: $5/parlay (1% bankroll)
Volume: 5 parlays/day
Daily EV: +$23 | Weekly: +$163
Goal: Learn the system, survive variance

PHASE 2 — Growth (Week 3-4)  
Stake: $10/parlay (2% bankroll)
Volume: 5-8 parlays/day
Daily EV: +$46 to +$74 | Weekly: +$325-$520
Goal: Compound winnings

PHASE 3 — Scale (Month 2+)
Stake: 2% of current bankroll
As bankroll grows, stakes grow automatically
$500 → $1,000 in ~11 days at standard pace

⚠️ VARIANCE WARNING
At 28% win rate, 7 losses in a row happens ~10% of the time.
At $5 stakes that's only -$35 (7% of bankroll).
One win at +780 odds recovers 8 losses.

🎯 KEY RULE: Never stake more than 3% per parlay.
```

#### 2. Update `handleCustomerStart()` (line 3383-3401)
Add a brief stake plan summary + prompt to run `/plan` for the full breakdown. Replace the current generic "Recommended Starter Balance: $200-$400" with a teaser pointing to `/plan`.

#### 3. Add `/plan` command to customer routing (line 4125-4153)
Add `if (cmd === "/plan") return await handleStakePlan(chatId);` to authorized customer commands.

#### 4. Add `/plan` to `/help` output (line 4133-4152)
Include `/plan — Your step-by-step profit plan` in the help menu.

### No Database Changes
All calculations use hardcoded constants from real performance data. Pure frontend/function change.

