
# Monetize the Bot: $100 Stakes + Public Landing Page + $99/mo Membership

## Overview

Three connected changes:
1. Reconfigure all stakes from $20 to $100 and backfill historical P&L proportionally
2. Build a public landing page showcasing bot performance (calendar, win/loss record, profit)
3. Gate daily parlay access behind a $99/month Stripe subscription

---

## Part 1: Reconfigure Stakes to $100

### What Changes
- **Generation engine**: Update flat stake from $20 to $100
- **Settlement engine**: Update fallback stake references from $10/$20 to $100
- **Historical backfill**: Run a SQL update to proportionally scale all existing P&L data (multiply by 5x since current data is $20-based)
- **Bankroll recalculation**: Recalculate `bot_activation_status.simulated_bankroll` and `daily_profit_loss` to reflect $100 unit size

### Technical Details

**bot-generate-daily-parlays/index.ts**
- Line 3782: Change default stake from `20` to `100`

**bot-settle-and-learn/index.ts**
- Lines 669, 670, 674, 699: Change all `parlay.simulated_stake || 10` fallbacks to `parlay.simulated_stake || 100`

**SQL Backfill** (run via migration):
```sql
-- Scale all historical parlays from $20 stake to $100 (5x multiplier)
UPDATE bot_daily_parlays 
SET simulated_stake = 100,
    profit_loss = profit_loss * 5,
    simulated_payout = CASE 
      WHEN simulated_payout IS NOT NULL AND simulated_payout > 0 
      THEN simulated_payout * 5 
      ELSE simulated_payout 
    END
WHERE simulated_stake = 20 OR simulated_stake = 10;

-- Recalculate daily P&L in activation status (5x)
UPDATE bot_activation_status 
SET daily_profit_loss = daily_profit_loss * 5,
    simulated_bankroll = 1000 + (simulated_bankroll - 1000) * 5;
```

---

## Part 2: Public Landing Page

### Design
A clean, mobile-first landing page at `/bot` (currently redirects to `/`) that showcases:

1. **Hero section**: "AI-Powered Daily Parlays" with key stats (total profit, win rate, days active)
2. **Performance calendar**: Monthly calendar view showing green (profitable) / red (loss) days -- visible to everyone but parlay details are locked
3. **Stats dashboard**: Overall record, ROI percentage, best day, current streak
4. **"Why Multiple Parlays" explainer**: Short section on the multi-parlay strategy
5. **Pricing CTA**: $99/month subscription card with feature list and checkout button

### What's Public vs. Locked
| Feature | Public | Members Only |
|---------|--------|-------------|
| Calendar (green/red days) | Yes | -- |
| Daily profit/loss amounts | Yes | -- |
| Overall win/loss record | Yes | -- |
| Individual parlay legs | No | Yes |
| Parlay odds and stakes | No | Yes |
| Strategy breakdowns | No | Yes |
| Real-time daily picks | No | Yes |

### New Files
- `src/pages/BotLanding.tsx` -- public landing page
- `src/components/bot-landing/HeroStats.tsx` -- hero with key metrics
- `src/components/bot-landing/PerformanceCalendar.tsx` -- public calendar (green/red days)
- `src/components/bot-landing/PricingCard.tsx` -- $99/mo subscription CTA
- `src/components/bot-landing/WhyMultipleParlays.tsx` -- strategy explainer

### Data Source
A new edge function `bot-public-stats` that returns aggregated performance data without exposing individual parlay details:
- Daily P&L and win/loss counts from `bot_activation_status`
- Overall totals (no auth required -- public data)

---

## Part 3: $99/month Telegram Bot Subscription

### Stripe Setup
- Create a new Stripe product: "Parlay Bot Pro" at $99/month
- Create a new checkout edge function: `create-bot-checkout`
- Update `check-subscription` to detect the new Bot Pro subscription and return `hasBotAccess: true`

### Access Control Flow
1. User visits `/bot` landing page -- sees public stats
2. User clicks "Join Now" -- triggers Stripe checkout ($99/mo)
3. After payment, `check-subscription` returns `hasBotAccess: true`
4. User can now view full parlay details on the calendar and access daily picks
5. Telegram bot `/subscribe` command links to the same checkout flow

### New/Modified Files
- `supabase/functions/create-bot-checkout/index.ts` -- new checkout function
- `supabase/functions/check-subscription/index.ts` -- add Bot Pro price detection
- `supabase/functions/bot-public-stats/index.ts` -- public stats API (no auth)
- `src/hooks/useSubscription.ts` -- add `hasBotAccess` field

### Route Changes (App.tsx)
- Change `/bot` from `Navigate to="/"` to render `BotLanding`
- Keep `/` as the admin `BotDashboard` (existing behavior for logged-in admins)

---

## Implementation Order

1. Create Stripe product + price for Bot Pro ($99/mo)
2. SQL migration to backfill stakes to $100
3. Update generation engine stake constant
4. Update settlement engine fallback stakes
5. Create `bot-public-stats` edge function
6. Create `create-bot-checkout` edge function
7. Update `check-subscription` to include Bot Pro
8. Build landing page components
9. Wire up routing and access control

### Files Modified
- `supabase/functions/bot-generate-daily-parlays/index.ts`
- `supabase/functions/bot-settle-and-learn/index.ts`
- `supabase/functions/check-subscription/index.ts`
- `src/hooks/useSubscription.ts`
- `src/App.tsx`

### Files Created
- `supabase/functions/create-bot-checkout/index.ts`
- `supabase/functions/bot-public-stats/index.ts`
- `src/pages/BotLanding.tsx`
- `src/components/bot-landing/HeroStats.tsx`
- `src/components/bot-landing/PerformanceCalendar.tsx`
- `src/components/bot-landing/PricingCard.tsx`
- `src/components/bot-landing/WhyMultipleParlays.tsx`
