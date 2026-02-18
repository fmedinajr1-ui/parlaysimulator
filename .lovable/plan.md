
# 3-Tier Subscription Redesign with Funding Access

## Overview

Replace the current single-tier $99 pricing card with a full 3-tier pricing section on the BotLanding page. "Access to funding" means subscribers at higher tiers get the bot to place bets using platform capital on their behalf — a prop-firm style funded account perk.

## The 3 Tiers

| Tier | Price | Key Hook |
|---|---|---|
| Entry | $99/mo | Bot picks via Telegram, full analytics |
| Pro | $399/mo | Everything in Entry + $1,000 funded account managed by the bot |
| Ultimate | $799/mo | Everything in Pro + $5,000 funded account + VIP strategy + priority support |

## What "Access to Funding" Means (displayed to users)

- **Pro ($399)**: Receive access to a **$1,000 funded betting account** — the bot places execution-tier parlays using platform capital. You keep a profit split (e.g. 70/30).
- **Ultimate ($799)**: Receive access to a **$5,000 funded betting account** — full bot automation at max stakes. You keep a higher profit split (e.g. 80/20).

This is prominently called out as a badge/highlight on those tiers.

---

## Files to Create / Edit

### 1. `src/components/bot-landing/PricingSection.tsx` (NEW)
A full 3-column pricing section that replaces `PricingCard`. Each tier gets its own card with:
- Tier name, badge (e.g. "Most Popular"), price, feature list
- Funding badge for Pro and Ultimate (e.g. "$1K Funded Account")
- Email input + CTA button per card
- `priceId` prop mapped to the correct Stripe price ID for each tier

Three price IDs to wire up (from Stripe products created in prior steps):
- Entry: existing `price_1T1HU99D6r1PTCBBLQaWi80Z` (the existing $99 price)
- Pro: new $399 price ID (created in Stripe — to be filled in)
- Ultimate: new $799 price ID (created in Stripe — to be filled in)

### 2. `src/pages/BotLanding.tsx` (EDIT)
- Replace `<PricingCard>` with `<PricingSection>`
- Pass `handleCheckout(email, priceId)` so each tier routes to the correct Stripe price
- Update `handleCheckout` to accept a `priceId` parameter

### 3. `supabase/functions/create-bot-checkout/index.ts` (EDIT)
- Accept `priceId` in the request body alongside `email`
- Fall back to the existing `BOT_PRO_PRICE_ID` if none provided (backward compat)
- Remove `trial_period_days` (per memory: no free trial on any tier)

### 4. `supabase/functions/check-subscription/index.ts` (EDIT)
- Add tier detection: check which price ID the active subscription belongs to
- Return `botTier: 'entry' | 'pro' | 'ultimate' | null` alongside `hasBotAccess`
- Entry tier = $99 price ID; Pro = $399 price ID; Ultimate = $799 price ID

### 5. `src/hooks/useSubscription.ts` (EDIT)
- Add `botTier: 'entry' | 'pro' | 'ultimate' | null` to `SubscriptionState`

---

## Visual Design Plan for PricingSection

```text
┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
│    ENTRY     │  │      PRO         │  │    ULTIMATE      │
│   $99/mo     │  │   $399/mo        │  │   $799/mo        │
│              │  │  ⭐ Most Popular  │  │  👑 VIP Tier     │
│ - Bot picks  │  │ - All Entry +    │  │ - All Pro +      │
│ - Telegram   │  │ - $1K Funded     │  │ - $5K Funded     │
│ - Calendar   │  │   Account        │  │   Account        │
│ - Analytics  │  │ - Execution      │  │ - Max stakes     │
│              │  │   tier parlays   │  │ - 80/20 split    │
│              │  │ - 70/30 split    │  │ - Priority DMs   │
│  [Join $99]  │  │  [Join $399]     │  │  [Join $799]     │
└──────────────┘  └──────────────────┘  └──────────────────┘
```

The Pro card will have a highlighted border (primary color) and "Most Popular" badge. The Ultimate card will have a gold/amber accent.

---

## Technical Notes

- The Stripe price IDs for the $399 and $799 tiers need to be confirmed. They were created earlier in this session — the exact IDs will be read from the Stripe products list if available, or placeholders will be added with a clear TODO comment.
- No webhook needed: subscription status is verified via Stripe API on the `check-subscription` function call, as already implemented.
- `hasBotAccess` continues to work for all 3 tiers (any active bot subscription = access). The new `botTier` field differentiates features on the dashboard if needed in future.
- The funding access feature is a **marketing/feature display** item for now — showing what subscribers get access to. It does not require new backend tables unless a funded account management system is built later.
