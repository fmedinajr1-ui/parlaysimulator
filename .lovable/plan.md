

## Customer Scout Access + $750 Scout Tier

### What We're Building

1. **A new "Scout" subscription tier at $750/mo** with a 1-day free trial, added to the landing page pricing grid
2. **A customer-facing Scout page** that shows only the Autopilot view with 4 tabs: Game Bets, Player Props, Lock Mode, and Advanced -- gated behind the Scout subscription (or admin access)
3. **Subscription gating** so non-Scout subscribers see an upgrade prompt instead of the full Scout tools

---

### Changes

#### 1. Create Stripe Product + Price
- Create a new Stripe product "Scout" at $750/mo recurring
- This gives us a `price_id` to use in checkout and subscription checks

#### 2. Update `check-subscription` Edge Function
**File:** `supabase/functions/check-subscription/index.ts`
- Add the new Scout price ID to `BOT_PRICE_IDS` map with tier `'scout'`
- Add a `hasScoutAccess` boolean to the response (true when botTier is `'scout'` or user is admin)
- Update the botTier type to include `'scout'`

#### 3. Update `create-bot-checkout` Edge Function
**File:** `supabase/functions/create-bot-checkout/index.ts`
- When the Scout price ID is passed, set `trial_period_days: 1` instead of 0
- All other tiers keep `trial_period_days: 0` as before

#### 4. Update `PricingSection` Component
**File:** `src/components/bot-landing/PricingSection.tsx`
- Add a 4th tier card: "Scout" at $750/mo with badge "Live Edge", features list including streaming analysis, player props, game bets, lock mode, and advanced analytics
- Show "1-day free trial" instead of "No free trial" for this tier
- Grid changes from 3-col to 4-col on desktop (2-col on mobile stays fine)

#### 5. Update `useSubscription` Hook
**File:** `src/hooks/useSubscription.ts`
- Add `hasScoutAccess` to the state interface (derived from `botTier === 'scout'` or `isAdmin`)
- Pass through from the `check-subscription` response

#### 6. Create Customer Scout Page Component
**File:** `src/pages/Scout.tsx` (modify existing)
- At the top of the component, check `hasScoutAccess` (or `isAdmin`) from `useSubscription`
- If user does NOT have Scout access: show a locked/upgrade card with the $750 Scout tier features and a "Start 1-Day Free Trial" CTA button that triggers checkout with the Scout price ID
- If user HAS access: show the current Scout page but **only the Autopilot mode** (skip the Upload, Live, Profile mode tabs) -- the customer sees:
  - Game Selector
  - Autopilot agent with streaming/video preview
  - The 4 content tabs: Game Bets, Player Props, Lock Mode, Advanced
- Hide the mode toggle tabs (Upload/Live/Auto/Profile) for customers -- they go straight into Autopilot
- Admins continue to see all modes as before

#### 7. Update Sidebar Navigation
**File:** `src/components/layout/DesktopSidebar.tsx`
- The Scout link is already accessible via quick actions; no sidebar change needed since it's already in the route list

---

### Technical Details

| Item | Detail |
|------|--------|
| New Stripe product | "Scout - Live Betting" at $750/mo with 1-day trial |
| Price ID | Will be created via Stripe tool, then hardcoded |
| Subscription check | `hasScoutAccess` field added to `check-subscription` response |
| Customer view | Autopilot mode only (GameBetsTab, HalftimeBettingPanel, LockModeTab, Advanced) |
| Admin view | Full Scout page with all 4 modes (Upload, Live, Autopilot, Profile) |
| Trial | 1-day free trial for Scout tier only; all other tiers remain trial-free |
| Gating | Non-subscribers see upgrade prompt with feature list and checkout CTA |

