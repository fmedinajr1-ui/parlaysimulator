

## Fix: Require Credit Card for $99/mo Plan Trial Signup

### Problem
The `create-checkout` function (your $99/mo subscription) allows people to start a 3-day free trial **without entering a credit card**. Stripe's default behavior when you only set `trial_period_days` without forcing payment collection is to skip the card requirement entirely.

Your bot checkout (`create-bot-checkout`) already has this fixed — it requires a card upfront. This fix applies the same pattern to the main subscription.

### The Fix

**File: `supabase/functions/create-checkout/index.ts`**

Add two properties to the checkout session creation:

**Before (broken — no card required):**
```typescript
mode: "subscription",
subscription_data: {
  trial_period_days: 3,
},
```

**After (fixed — card required):**
```typescript
mode: "subscription",
payment_method_collection: "always",
subscription_data: {
  trial_period_days: 3,
  trial_settings: {
    end_behavior: {
      missing_payment_method: "cancel",
    },
  },
},
```

### What This Does
- `payment_method_collection: "always"` — Forces Stripe to collect a valid card before the trial begins
- `trial_settings.end_behavior.missing_payment_method: "cancel"` — Safety net: if somehow no card is attached when the trial ends, the subscription auto-cancels instead of creating an unpaid invoice

### Scope
One file changed: `supabase/functions/create-checkout/index.ts` (2 lines added)

