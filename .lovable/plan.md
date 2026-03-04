

# Make Stake Sizing Reflect in Telegram Messages

## Problem
The Telegram bot has hardcoded `$500` and `$100` fallback values in several places, so even though `bot_stake_config` was updated to $100/$50/$20/$10, the Telegram messages still show old stake amounts.

## Locations to Fix

### 1. Settlement Alert — `bot-send-telegram/index.ts` line 1397
```typescript
const stakeVal = stake || 500;  // ← hardcoded $500 fallback
```
**Fix**: Change fallback to `100` (new execution baseline). The `stake` value is already passed from `bot-settle-and-learn` (line 984: `parlay.simulated_stake || 500`), so also fix that fallback.

### 2. Settlement Sender — `bot-settle-and-learn/index.ts` line 984
```typescript
stake: parlay.simulated_stake || 500,  // ← hardcoded $500 fallback
```
**Fix**: Change fallback to `100`.

### 3. Explorer Format — `bot-send-telegram/index.ts` line 483
```typescript
msg += `💰 $100 → ~$${payout.toLocaleString()}\n`;  // ← hardcoded $100
```
This one already matches the new exploration-tier stake ($100 for execution context shown here). However, the payout calculation likely uses old values too — need to verify and make it dynamic using the passed stake value.

### 4. Lottery Ticket Display — `bot-send-telegram/index.ts` line 1235
Already uses `ticket.stake` dynamically — no change needed.

### 5. Daily Winners Recap — line 1267
Already uses `lw.stake` dynamically — no change needed.

## Changes

| File | Line | Current | New |
|------|------|---------|-----|
| `bot-settle-and-learn/index.ts` | 984 | `parlay.simulated_stake \|\| 500` | `parlay.simulated_stake \|\| 100` |
| `bot-send-telegram/index.ts` | 1397 | `stake \|\| 500` | `stake \|\| 100` |
| `bot-send-telegram/index.ts` | 483 | Hardcoded `$100` | Use passed stake/payout values from payload |
| `bot-force-fresh-parlays/index.ts` | 541 | `stakeConfig?.execution_stake ?? 500` | `stakeConfig?.execution_stake ?? 100` |

## Deployment
Redeploy `bot-send-telegram`, `bot-settle-and-learn`, and `bot-force-fresh-parlays` after changes.

