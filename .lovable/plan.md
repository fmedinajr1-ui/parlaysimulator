

# Lottery Winner Highlight in Daily Recap

## Overview
Enhance the daily winners broadcast to specifically highlight winning lottery tickets with their payout amounts, tier, and odds in a dedicated "Lottery Hits" section of the next-day recap message.

## Changes

### 1. `supabase/functions/daily-winners-broadcast/index.ts`
- When building `winnersData`, tag each winner with `isLottery: true` if `strategy_name === 'mega_lottery_scanner'`
- Calculate the actual payout for each lottery winner using the `expected_odds` and `simulated_stake` (decimal odds conversion)
- Pass a new `lotteryWinners` array in the Telegram payload containing: tier, odds, payout, profit, and legs

### 2. `supabase/functions/bot-send-telegram/index.ts`
- Update `formatDailyWinnersRecap` to render a highlighted "LOTTERY HITS" section at the top of the recap when lottery winners exist
- Each lottery hit shows the tier emoji, odds, stake, and payout in a visually distinct format
- Example output:

```
🏆 YESTERDAY'S WINS — Mar 1
━━━━━━━━━━━━━━━━━━━━

🎰 LOTTERY HITS! 🎰
━━━━━━━━━━━━━━━━━━━━
🎟️ STANDARD (+1041) — $500 stake → $5,705 payout (+$5,205)
  ✅ Karl-Anthony Towns REB O8.5 (actual: 12)
  ✅ Jalen Brunson AST O6.5 (actual: 9)
  ✅ OG Anunoby STL O1.5 (actual: 2)

Solid Day — 4 Winners

#1 | Execution | +245 | $1,225 profit
  ✅ ...

💰 Total: +$8,430 profit across 4 winners
```

## Technical Details

**Payout calculation** (already used in `formatParlaySettledAlert`):
```typescript
const decimalOdds = odds > 0 ? (odds / 100) + 1 : (100 / Math.abs(odds)) + 1;
const payout = Math.round(stake * decimalOdds);
```

**Lottery identification**: Filter winners where `strategy_name === 'mega_lottery_scanner'`

**Files changed:**
| File | Action |
|------|--------|
| `supabase/functions/daily-winners-broadcast/index.ts` | Modify — tag lottery winners, add payout data |
| `supabase/functions/bot-send-telegram/index.ts` | Modify — add lottery highlight section to recap formatter |

