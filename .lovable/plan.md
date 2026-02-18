
# Fix: Grant Trialing Customer Access + Remove Free Trials

## What's Happening

There is one customer (subscription `sub_1T2DKs9D6r1PTCBBUMFF3ZQP`) stuck in `trialing` status on the Entry plan ($99/mo). The `check-subscription` function only looks for `status: "active"` subscriptions — so when it checks this customer's Stripe account, it finds nothing and treats them as unsubscribed. They are locked out despite having signed up.

The trial was likely created automatically because the Stripe **price or product** had a default trial period configured in the Stripe dashboard. The `create-bot-checkout` code itself does not set `trial_period_days`, but Stripe can inherit trial settings from the price object.

---

## Three Things Being Fixed

### 1. `check-subscription` — Accept `trialing` Status as Valid

The subscriptions query currently does:
```
stripe.subscriptions.list({ status: "active" })
```

It will be changed to fetch both `active` AND `trialing` subscriptions, then merge the results. A `trialing` subscription gets the same full access as an `active` one — `hasBotAccess: true`, `subscribed: true`, `scansRemaining: -1`.

### 2. `create-bot-checkout` — Explicitly Block Future Trials

Add `trial_period_days: 0` to the Stripe checkout session creation. This overrides any default trial the Stripe price might have, ensuring no future customer gets a free trial at checkout.

```ts
const session = await stripe.checkout.sessions.create({
  ...
  subscription_data: {
    trial_period_days: 0,  // ← explicitly disable trials forever
  },
  ...
});
```

### 3. `send-bot-access-email` — New Edge Function

A new edge function that sends the trialing customer (and any future trialing/newly-subscribed customer) a welcome email with their Telegram bot access link. This serves as the "bot access" confirmation.

The email will:
- Be sent via Resend (already configured)
- Contain the Telegram bot link: `https://t.me/parlayiqbot`
- Match the existing dark-themed email style already used in the codebase
- Be triggerable manually (to immediately send to the stuck trialing customer) or automatically from the webhook for new subscribers

---

## Files Being Changed

### File 1: `supabase/functions/check-subscription/index.ts` (EDIT)

Change the subscription lookup from a single `active` query to two queries — one for `active`, one for `trialing` — then combine results. The trialing customer will now receive full bot access.

### File 2: `supabase/functions/create-bot-checkout/index.ts` (EDIT)

Add `subscription_data: { trial_period_days: 0 }` to the checkout session creation. This is the permanent fix to ensure no future customer gets a free trial.

### File 3: `supabase/functions/send-bot-access-email/index.ts` (NEW)

New edge function that accepts `{ email }` and sends a styled HTML welcome email with the Telegram bot link. After deploying, it will be called once manually against the trialing customer's email to give them immediate access.

---

## After Deployment — Manual Step

Once deployed, the bot access email will be manually triggered for the trialing customer by calling `send-bot-access-email` with their email address. This gives them immediate access without waiting for their trial period to end or their first payment to process.

---

## What Is NOT Changing

- The trialing subscription itself is NOT canceled — the customer keeps their current billing arrangement (they'll be charged when the trial ends)
- No database schema changes needed
- No Stripe dashboard changes needed (the code fix handles everything)
- The `stripe-webhook` is not touched in this change (separate concern from the payment failure audit)
