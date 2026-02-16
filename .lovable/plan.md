
# Remove All Subscriptions Except Parlay Bot Pro

## Overview
Strip out the Odds Tracker Pro and Elite Hitter Pro subscription tiers, keeping only **Parlay Bot Pro** ($99/month, 3-day trial). The features themselves (Odds Tracker page, Elite Hitter card) will remain accessible but without paywalls -- only the separate subscription products are being removed.

## Changes

### 1. Backend: Simplify `check-subscription` Edge Function
- Remove `ODDS_TRACKER_PRICE_ID` and `ELITE_HITTER_PRICE_ID` constants
- Remove the per-price subscription checks (`hasOddsSubscription`, `hasEliteHitterSubscription`)
- Keep only `BOT_PRO_PRICE_ID` check
- Simplify response: if user has ANY active Stripe subscription, grant full access (odds, elite, bot)
- Remove `approved_odds_users` table lookup since there's no separate odds tier

### 2. Backend: Delete Edge Functions
- Delete `supabase/functions/create-odds-checkout/` (no longer needed)
- Delete `supabase/functions/create-elite-hitter-checkout/` (no longer needed)

### 3. Frontend: Simplify `useSubscription` Hook
- Remove `hasOddsAccess`, `hasEliteHitterAccess` from state
- Remove `startEliteHitterCheckout` function
- Keep `startBotCheckout` as the single checkout flow
- Keep `hasBotAccess` (rename concept to just "subscribed")

### 4. Frontend: Remove Paywalls
- **OddsMovement page**: Remove `OddsPaywall` import and the paywall gate -- make the page accessible to all authenticated users (or keep existing pilot logic)
- **DailyEliteHitterCard**: Remove `EliteHitterPaywall` gate -- show content without subscription check
- Delete `src/components/odds/OddsPaywall.tsx`
- Delete `src/components/suggestions/EliteHitterPaywall.tsx`

### 5. Frontend: Clean Up Contexts
- **PilotUserContext**: Remove `hasOddsAccess` and `hasEliteAccess` fields
- **usePilotUser**: Remove corresponding fields

### 6. Admin Panel
- Keep `EliteAccessManager` and `FeatureAccessManager` for role-based access (admin can still grant roles) -- these are orthogonal to Stripe subscriptions

## Files Modified
- `supabase/functions/check-subscription/index.ts` -- simplify price checks
- `supabase/functions/create-odds-checkout/index.ts` -- DELETE
- `supabase/functions/create-elite-hitter-checkout/index.ts` -- DELETE
- `src/hooks/useSubscription.ts` -- remove odds/elite checkout and state
- `src/contexts/PilotUserContext.tsx` -- remove odds/elite access fields
- `src/hooks/usePilotUser.ts` -- remove odds/elite access fields
- `src/pages/OddsMovement.tsx` -- remove paywall gate
- `src/components/suggestions/DailyEliteHitterCard.tsx` -- remove paywall gate
- `src/components/odds/OddsPaywall.tsx` -- DELETE
- `src/components/suggestions/EliteHitterPaywall.tsx` -- DELETE
