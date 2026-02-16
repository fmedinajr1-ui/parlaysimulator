
# Blue "Broke Even" for Zero P&L Days + Telegram & Homepage Updates

## 1. Performance Calendar (Public) -- `src/components/bot-landing/PerformanceCalendar.tsx`

Add a check for `profitLoss === 0` days:
- Show "Even" label instead of "+0"
- Use blue styling: `bg-blue-500/15 border-blue-500/30 text-blue-400`
- Three-way conditional: profitable (green) / even (blue) / loss (red)

## 2. Admin Calendar -- `src/components/bot/BotPnLCalendar.tsx`

Same treatment for zero-profit days:
- Detect `profitLoss === 0` separately from "no data" (currently `hasData` excludes zero -- fix this)
- Show "Even" label with blue heatmap color: `hsl(210 100% 55%)` for border/text, `hsl(210 100% 55% / 0.15)` for background

## 3. Telegram Welcome -- `supabase/functions/telegram-webhook/index.ts`

Update `handleCustomerStart` to include starter balance recommendation:

```
Welcome to Parlay Farm!

Recommended Starter Balance: $200-$400
Stake $10-$20 per parlay -- we generate multiple parlays daily,
so smaller stakes let you spread across all picks.

Use /parlays to see today's picks.

One winning day can return 10x your investment.
```

## 4. Homepage Tagline -- `src/components/bot-landing/HeroStats.tsx`

Add a highlighted line below the stats grid:
> "One winning day can return 10x your investment"

Styled with `text-blue-400` or `text-accent` as a subtle callout.

## Files Modified
- `src/components/bot-landing/PerformanceCalendar.tsx`
- `src/components/bot/BotPnLCalendar.tsx`
- `supabase/functions/telegram-webhook/index.ts`
- `src/components/bot-landing/HeroStats.tsx`
