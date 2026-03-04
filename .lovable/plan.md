

# Fix "113 Parlays" Count in Telegram Notifications

## Problem
The `formatTieredParlaysGenerated` function in `bot-send-telegram/index.ts` has a fallback DB lookup (lines 547-551) that queries ALL parlays for today without filtering by `outcome = 'pending'`. This counts voided parlays too, producing the inflated "113 parlays" message on Telegram.

## Root Cause
```typescript
// Line 547-550 — NO outcome filter
const { data: todayParlays } = await sb
  .from('bot_daily_parlays')
  .select('strategy_name')
  .eq('parlay_date', today);
```

This fallback fires when the generation payload has `totalCount === 0` or all tier counts are zero — which happens during pipeline runs that suppress counts. It then pulls every record for the day (pending + voided) and reports that total.

## Fix

### `bot-send-telegram/index.ts` — Line 550
Add `.eq('outcome', 'pending')` to the fallback query:

```typescript
const { data: todayParlays } = await sb
  .from('bot_daily_parlays')
  .select('strategy_name')
  .eq('parlay_date', today)
  .eq('outcome', 'pending');
```

This single-line change ensures the fallback only counts active parlays, matching the fix already applied to `bot-slate-status-update`.

## Deployment
Redeploy `bot-send-telegram` after the change.

