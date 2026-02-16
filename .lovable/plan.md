

# Update Hero Stats and Lock Down Telegram Bot

## Part 1: Hero Stats Changes

Replace the current 4-stat grid (Total Profit, Win Rate, Days Active, Record) with a simpler 2-stat layout:

- **Total Profit** -- keep as-is
- **Total Wins** -- show "25 Wins" (dynamic from `totalWins`)

Remove: Win Rate card, Days Active card, Record card.

The stats grid changes from `grid-cols-2 sm:grid-cols-4` to `grid-cols-2` with just two cards.

Update `HeroStatsProps` to only require `totalProfit` and `totalWins`. Clean up the parent `BotLanding.tsx` to stop passing unused props.

## Part 2: Telegram Bot -- Customer-Only Access

Currently the Telegram bot exposes 30+ commands to anyone who messages it (admin commands like `/generate`, `/settle`, `/force-settle`, `/pause`, `/bankroll`, analytics, learning, etc.). Paying customers should only see today's generated parlays.

### Changes to `telegram-webhook/index.ts`:

1. **Define an admin chat ID check** -- use the existing `TELEGRAM_CHAT_ID` env var as the admin. Only the admin can run all commands.

2. **For non-admin users, restrict to these commands only:**
   - `/start` -- welcome message (simplified for customers)
   - `/parlays` -- view today's generated parlays (the core value)
   - `/parlay` -- view individual parlay leg details

3. **Block all other commands for non-admin users** -- respond with a friendly message like "This command is only available to admins."

4. **Disable natural language AI chat for non-admin users** -- customers get a simple "Use /parlays to see today's picks" response instead.

### Customer `/start` message:
Show a simple welcome with only the commands they can use (`/parlays`), not the full 30-command suite.

## Part 3: Dry Run Test

After deploying the Telegram webhook changes, we will invoke the `bot-generate-daily-parlays` edge function with `dry_run: true` to verify the generation pipeline works. This tests scoring logic, correlation taxes, and parlay building without writing to the database.

## Files Modified

- `src/components/bot-landing/HeroStats.tsx` -- Simplify to 2 stats
- `src/pages/BotLanding.tsx` -- Update props passed to HeroStats
- `supabase/functions/telegram-webhook/index.ts` -- Add admin-only gating, simplify customer commands

## Technical Details

### Admin Check Logic
```typescript
const ADMIN_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID");
const isAdmin = (chatId: string) => chatId === ADMIN_CHAT_ID;
```

In `handleMessage`, check `isAdmin(chatId)` before routing to admin commands. Non-admin users get routed only to `/start`, `/parlays`, `/parlay`.

### HeroStats Simplified Interface
```typescript
interface HeroStatsProps {
  totalProfit: number;
  totalWins: number;
}
```

Two cards side by side: Total Profit and Total Wins.

