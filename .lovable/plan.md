

# Enforce Card-Only Payments + Auto Bot Password on All Subscriptions

## Problem

1. Users bypass payment using Link, Google Pay, Apple Pay, and other wallet methods that may not properly validate the card during trial signups
2. The main app subscription (`create-checkout`) does NOT generate a bot access password -- only `create-bot-checkout` does. Users who subscribe through the main flow never get their Telegram bot link + passcode

## Solution

### Part 1: Card-Only + $0.01 Hold (Both Checkout Functions)

Add to both `create-checkout` and `create-bot-checkout`:

- `payment_method_types: ['card']` -- removes Link, Apple Pay, Google Pay, all wallets
- A one-time `$0.01` "Card verification fee" line item that forces Stripe to authorize the card immediately
- Updated `custom_text` mentioning the $0.01 verification charge

### Part 2: Auto-Generate Bot Password in Main Checkout

Currently `create-checkout` redirects to `/upload?success=true` with no bot password. We need to:

1. **Add password generation to `create-checkout`** -- same logic as `create-bot-checkout` (generate 8-char password, insert into `bot_access_passwords`, store `password_id` in session metadata)
2. **Change success URL** from `/upload?success=true` to `/bot-success?session_id={CHECKOUT_SESSION_ID}` so users land on the existing BotSuccess page that shows their one-time passcode + Telegram link

This means every subscriber (bot or main app) automatically gets their Telegram bot access code on the success page.

## Files Modified

### 1. `supabase/functions/create-checkout/index.ts`

- Add `generatePassword()` function (same as in `create-bot-checkout`)
- Switch from `SUPABASE_ANON_KEY` to `SUPABASE_SERVICE_ROLE_KEY` (needed to insert into `bot_access_passwords`)
- Generate password and insert into `bot_access_passwords` before creating checkout session
- Add `payment_method_types: ['card']`
- Add $0.01 verification line item
- Store `password_id` in session metadata
- Change `success_url` to `/bot-success?session_id={CHECKOUT_SESSION_ID}`
- Update `custom_text` to mention $0.01 hold

### 2. `supabase/functions/create-bot-checkout/index.ts`

- Add `payment_method_types: ['card']`
- Add $0.01 verification line item to both scout and non-scout flows
- Update `custom_text` to mention $0.01 hold
- Generate password for scout tier too (currently skipped) so scout subscribers also get a bot passcode
- Change scout `success_url` from `/scout` to `/bot-success?session_id={CHECKOUT_SESSION_ID}`

## Technical Details

**$0.01 line item (added to both functions):**
```typescript
line_items: [
  { price: PRICE_ID, quantity: 1 },
  {
    price_data: {
      currency: 'usd',
      product_data: { name: 'Card verification fee' },
      unit_amount: 1, // $0.01
    },
    quantity: 1,
  },
],
payment_method_types: ['card'],
```

**Password generation (added to create-checkout):**
```typescript
const password = generatePassword();
const { data, error } = await supabaseClient
  .from("bot_access_passwords")
  .insert({ password, created_by: "stripe_checkout", is_active: true, max_uses: 1 })
  .select("id").single();
```

**Success URL change (create-checkout):**
```
Before: /upload?success=true
After:  /bot-success?session_id={CHECKOUT_SESSION_ID}
```

## Impact

After this change:
- Only real credit/debit cards accepted (no Link, wallets, Apple Pay, Google Pay)
- Every trial signup clears a $0.01 charge proving the card is valid and funded
- Every subscriber (main app OR bot) automatically lands on the bot-success page with their one-time Telegram passcode and bot link
- No separate step needed to get bot access -- it's part of the subscription flow

