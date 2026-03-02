

# Track Lottery Tier Performance and Auto-Adjust Strategy

## Overview
Query historical win/loss data per lottery tier (Standard, High Roller, Mega Jackpot) from `bot_daily_parlays`, then use the tier-level hit rates to dynamically adjust stake sizing and quality thresholds during ticket generation.

## Changes

### 1. Create `bot_lottery_tier_performance` table (new migration)
A dedicated table to store aggregated tier-level stats, refreshed alongside other hit-rate tables.

| Column | Type | Description |
|--------|------|-------------|
| tier | text (PK) | standard, high_roller, mega_jackpot |
| total_tickets | int | Total tickets generated |
| total_won | int | Tickets that hit |
| total_lost | int | Tickets that missed |
| win_rate | numeric | Win percentage |
| avg_odds | numeric | Average combined odds |
| avg_payout | numeric | Average payout when won |
| total_profit | numeric | Cumulative P/L |
| streak | int | Current consecutive W/L streak |
| last_updated | timestamp | Last refresh time |

### 2. Update `bot-update-engine-hit-rates/index.ts`
Add a new section (E) that aggregates lottery tier performance:
- Query all `bot_daily_parlays` where `strategy_name = 'mega_lottery_scanner'` grouped by `tier`
- Calculate win rate, average odds, total profit, and current streak per tier
- Upsert results into `bot_lottery_tier_performance`
- Log which tiers are hot or cold

### 3. Update `nba-mega-parlay-scanner/index.ts`
- Fetch `bot_lottery_tier_performance` in the existing `Promise.all` block
- Use tier win rates to dynamically adjust:
  - **Stake sizing**: Hot tiers (win rate above 20%) get a stake bump (e.g., standard $5 to $7), cold tiers get reduced stakes
  - **Quality floor**: Cold tiers (win rate below 5% over 20+ tickets) raise the minimum hit rate for leg selection by +5%, making picks more conservative
  - **Logging**: Print tier performance context at the start of each ticket build section

### 4. Update daily winners broadcast (minor)
- Include tier win rate context in the recap payload so the Telegram message can optionally show "Standard tickets hitting at 18% this month"

## Technical Details

**Stake adjustment formula:**
```text
baseStake = { standard: 5, high_roller: 3, mega_jackpot: 1 }
if tierWinRate > 20% and totalTickets >= 10:
  stake = baseStake * 1.4  (bump)
if tierWinRate < 5% and totalTickets >= 20:
  stake = baseStake * 0.6  (reduce)
  minHitRate += 5  (tighten quality)
```

**Files changed:**
| File | Action |
|------|--------|
| New migration SQL | Create `bot_lottery_tier_performance` table |
| `supabase/functions/bot-update-engine-hit-rates/index.ts` | Add section E for lottery tier aggregation |
| `supabase/functions/nba-mega-parlay-scanner/index.ts` | Fetch tier stats, adjust stakes and quality floors |
| `supabase/functions/daily-winners-broadcast/index.ts` | Pass tier performance context in payload |

