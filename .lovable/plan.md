

## Add Scout Paywall to Homepage and Simplify to 2 Tiers

### What Changes

1. **Remove Pro ($399) and Ultimate ($799) tiers** from `PricingSection.tsx` -- these were the funded-account tiers
2. **Keep only Entry ($99, renamed "Parlay Bot") and Scout ($750)**
3. **Add the pricing section to the homepage** (`Index.tsx`) so visitors see subscription options directly
4. **Update grid layout** from 4-column to 2-column since there are only 2 tiers
5. **Clean up unused code** -- remove funding badge logic, gold accent styling, and Pro/Ultimate price constants

### Technical Details

**1. `src/components/bot-landing/PricingSection.tsx`**

- Remove `PRO_PRICE_ID` and `ULTIMATE_PRICE_ID` constants
- Remove the Pro and Ultimate tier objects from the `tiers` array
- Rename Entry tier to "Parlay Bot" with updated CTA text
- Make Entry the highlighted tier (since there's no Pro to highlight anymore)
- Remove `TrendingUp` import and funding badge rendering logic (no tiers use it)
- Remove `goldAccent` styling branches from TierCard (no tier uses it)
- Update grid from `lg:grid-cols-4` to `md:grid-cols-2` for the 2-card layout
- Update subtitle copy to reflect the simplified offering

**2. `src/pages/Index.tsx`**

- Import `PricingSection` from `@/components/bot-landing/PricingSection`
- Import `supabase` for the checkout flow
- Add the `PricingSection` component between `WeeklyParlayHistory` and `HowItWorks`
- Wire up the `handleCheckout` function (calls `create-bot-checkout` with email + priceId)
- Only show pricing to non-subscribed users (hide for admins and existing subscribers)

**3. `src/pages/BotLanding.tsx`**

- No structural changes needed -- it already uses `PricingSection` and will automatically reflect the reduced tiers

### Tier Configuration (After)

```text
Tier          Price    Badge         Highlight    Trial
─────────     ─────   ───────────   ─────────    ─────
Parlay Bot    $99/mo   Most Popular  Yes          No
Scout         $750/mo  Live Edge     No           1-day
```

### Homepage Layout (After)

```text
HeroBanner
Sign Out (if logged in)
Quick Actions
Main CTA (Analyze Your Parlay)
SlateRefreshControls
Elite3PTFixedParlay
WhenWeWinBig
DailyParlayHub
SweetSpotPicksCard
WeeklyParlayHistory
── NEW: PricingSection (2 cards: Parlay Bot + Scout) ──
HowItWorks
```

