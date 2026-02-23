

## Free Trial Agreement + Cancel Subscription via Telegram

### 1. Stripe Checkout — Add Trial Terms Agreement

**File:** `supabase/functions/create-bot-checkout/index.ts`

Add `consent_collection` and `subscription_data.trial_settings` to the Stripe checkout session so users must explicitly agree to the free trial terms (3-day free, then charged $99/mo) before subscribing.

Changes:
- Add `consent_collection: { terms_of_service: 'required' }` to make users agree to terms
- Add `payment_method_collection: 'always'` so card is collected upfront during the trial
- Add `subscription_data.trial_settings.end_behavior.missing_payment_method: 'cancel'` as a safety net

Note: Stripe's checkout page will automatically show the trial disclosure ("Free for 3 days, then $99/month") when `trial_period_days` is set and payment method is collected.

### 2. Telegram `/cancel` Command for Customers

**File:** `supabase/functions/telegram-webhook/index.ts`

Add a `/cancel` command available to authorized customers that:
1. Looks up the customer in `bot_authorized_users` by `chat_id`
2. Finds their email in the `email_subscribers` table (email is captured at checkout)
3. Calls Stripe API to find their active subscription and cancel it (at period end, not immediately)
4. Sends admin a notification about the cancellation
5. Responds to the user with confirmation

New function: `handleCancelSubscription(chatId)`

Flow:
```text
Customer sends /cancel
  -> Confirm with inline button ("Are you sure? You'll keep access until [end date]")
  -> On confirm: find Stripe customer by email -> cancel subscription at period end
  -> Notify admin via sendMessage to ADMIN_CHAT_ID
  -> Reply to customer with cancellation confirmation + end date
```

### 3. Stripe Webhook — Handle Cancellation Events

**File:** `supabase/functions/stripe-webhook/index.ts`

Add handling for `customer.subscription.deleted` and `customer.subscription.updated` events to:
- Notify admin via Telegram when a subscription is actually canceled or enters cancellation
- Optionally deactivate the user in `bot_authorized_users` when subscription fully expires

### 4. Customer Help Update

**File:** `supabase/functions/telegram-webhook/index.ts`

Add `/cancel` to the customer `/help` menu.

### Changes Summary

| File | Change |
|------|--------|
| `supabase/functions/create-bot-checkout/index.ts` | Add `payment_method_collection: 'always'` for upfront card collection during trial |
| `supabase/functions/telegram-webhook/index.ts` | Add `/cancel` command + confirmation flow + admin notification |
| `supabase/functions/stripe-webhook/index.ts` | Handle `customer.subscription.deleted` / `updated` events, notify admin via Telegram |

### Technical Details

**Cancel flow in telegram-webhook:**
- New `handleCancelSubscription(chatId)` function
- Uses inline keyboard for confirmation (reuses existing `handleCallbackQuery` pattern)
- Looks up email from `email_subscribers` table by matching metadata or from `bot_authorized_users`
- Calls `stripe.subscriptions.update(subId, { cancel_at_period_end: true })` (graceful cancel, keeps access until period ends)
- Sends admin notification: "Customer @username (chat_id) requested cancellation. Sub ends [date]."

**Webhook additions:**
- `customer.subscription.updated` with `cancel_at_period_end === true` -> notify admin
- `customer.subscription.deleted` -> deactivate user in `bot_authorized_users` + notify admin

