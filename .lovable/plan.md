

## Add 3-Day Free Trial for Parlay Bot

Two small changes needed:

### 1. Backend: Update `supabase/functions/create-bot-checkout/index.ts`

Change the trial logic on line 43 so Parlay Bot gets a 3-day trial (instead of 0), while Scout keeps its 1-day trial:

```typescript
// Current:  trial_period_days: isScoutTier ? 1 : 0,
// New:      trial_period_days: isScoutTier ? 1 : 3,
```

### 2. Frontend: Update `src/components/bot-landing/PricingSection.tsx`

- Set `hasTrial: true` on the Parlay Bot tier (line 35)
- Update the trial label text from `'1-day free trial'` to show the correct duration per tier
- Update the CTA button text to mention the trial (e.g., "Start 3-Day Free Trial — $99/mo")

**Changes:**
- Line 35: `hasTrial: false` -> `hasTrial: true`
- Line 34: CTA text -> `"Start 3-Day Free Trial — $99/mo"`
- Line 151: Update trial text to differentiate between tiers:
  - Parlay Bot: "3-day free trial"
  - Scout: "1-day free trial"

