

## Add Stake Info to Daily Winners Recap Telegram Message

### What's Missing
The daily winners recap message currently shows profit per winner and total profit, but not the individual stake sizes or the total amount staked for the day. The data is already available — each winner object has a `stake` field, it's just not displayed.

### Changes

**1. `daily-winners-broadcast/index.ts`** — Add `totalStaked` to the telegram payload
- After line 89, calculate total staked across all winners (not just top 10): `const totalStaked = winners.reduce((sum, w) => sum + (w.simulated_stake || 0), 0);`
- Add `totalStaked: Math.round(totalStaked)` to the payload data object (line 157)

**2. `bot-send-telegram/index.ts`** — Update `formatDailyWinnersRecap` to display stakes
- Extract `totalStaked` from data (line 1363)
- **Per-winner line** (line 1390): Change from `$${w.profit} profit` to `$${w.stake} stake → +$${w.profit} profit`
- **Total line** (line 1399): Change to show both total staked and total profit:
  `💰 Total: $X staked → +$Y profit (Z% ROI)`

