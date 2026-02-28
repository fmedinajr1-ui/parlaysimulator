

# Change Card Verification from $0.01 to $20.00

## Current State (Verified)

Both checkout functions correctly enforce free trials:
- `create-bot-checkout`: 3-day trial (1-day for scout tier), card-only, TOS required, auto-cancel if no payment method
- `create-checkout`: 3-day trial, card-only, TOS required, auto-cancel if no payment method

The card verification fee is currently $0.01 (`unit_amount: 1`) in both files.

## Changes

### 1. `supabase/functions/create-bot-checkout/index.ts`
- Change `unit_amount: 1` to `unit_amount: 2000` ($20.00)
- Update product name from "Card verification fee" to "Card authentication hold"
- Update TOS message: replace "$0.01" with "$20" in both scout and non-scout messages

### 2. `supabase/functions/create-checkout/index.ts`
- Change `unit_amount: 1` to `unit_amount: 2000` ($20.00)
- Update product name from "Card verification fee" to "Card authentication hold"
- Update TOS message: replace "$0.01" with "$20"

## Note
The $20 charge is a one-time line item added to the checkout session alongside the subscription. Stripe will charge this immediately at checkout while the subscription enters the trial period. If you want this to be a refundable hold rather than a permanent charge, that would require a different Stripe flow (using SetupIntents with authorization holds), which is significantly more complex. This plan keeps the current approach of a real charge.

