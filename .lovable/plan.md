

# Open Customer Commands for Subscribers

## Summary

Expand the customer-accessible Telegram commands from 3 to 7, giving paying subscribers more value without exposing admin-only controls (generate, settle, pause, etc.).

## Commands to Open Up

| Command | What It Does | Why Subscribers Want It |
|---------|-------------|----------------------|
| `/performance` | Win rate, ROI, record | Track bot's overall results |
| `/calendar` | Monthly P&L breakdown | See daily profit/loss history |
| `/roi` | 7d/30d/all-time ROI + strategy breakdown | Deeper performance insight |
| `/streaks` | Hot and cold category streaks | Know what's working now |
| `/help` | List available commands | Discoverability for new users |

## Commands That Stay Admin-Only

Generate, settle, force-settle, pause, resume, bankroll, weights, research, backtest, watch, explore, validate, tiers, learning, compare, sharp, avoid, subscribe, unsubscribe, export, digest, natural language chat, and all multi-sport commands.

## Changes

### 1. `supabase/functions/telegram-webhook/index.ts`

In the `handleMessage` router (~line 1644-1654), move `/performance`, `/calendar`, `/roi`, and `/streaks` above the admin gate so they're available to everyone.

Add a new `/help` command for customers that lists their available commands with descriptions.

Update `handleCustomerStart` to mention the available commands:

```
Welcome to Parlay Farm!

Recommended Starter Balance: $200-$400
Stake $10-$20 per parlay

Commands:
/parlays - Today's picks
/parlay  - Pending summary
/performance - Win rate & ROI
/calendar - Monthly P&L
/roi - Detailed ROI breakdown
/streaks - Hot & cold streaks
/help - All commands

One winning day can return 10x your investment.
```

### 2. No other files affected

All handler functions (`handlePerformance`, `handleCalendar`, `handleRoi`, `handleStreaks`) already exist and work without admin-specific context. They just need to be moved above the admin gate in the router.

## Technical Details

The router change is minimal -- move 4 lines from below the `if (!isAdmin(chatId))` check to above it, and add one new `/help` handler:

```typescript
// Customer commands (available to everyone)
if (cmd === "/start") { ... }
if (cmd === "/parlays") { ... }
if (cmd === "/parlay") { ... }
if (cmd === "/performance") return await handlePerformance(chatId);
if (cmd === "/calendar") return await handleCalendar(chatId);
if (cmd === "/roi") return await handleRoi(chatId);
if (cmd === "/streaks") return await handleStreaks(chatId);
if (cmd === "/help") return await handleCustomerHelp(chatId);

// All other commands: admin only
if (!isAdmin(chatId)) { ... }
```

