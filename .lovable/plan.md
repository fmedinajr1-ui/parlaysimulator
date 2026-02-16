

# Fix Landing Page: Parlay Farm Branding, No Auth, Telegram Redirect

## Summary

Update the landing page to use Parlay Farm branding, remove sign-in requirements, make it the homepage, and redirect customers to `https://t.me/parlayiqbot` after purchase.

## Changes

### 1. Routing -- `src/App.tsx`
- Change `/` from `BotDashboard` to `BotLanding` (public homepage)
- Change `/bot` to redirect to `/`
- Admin dashboard stays at `/admin`

### 2. Branding -- `src/pages/BotLanding.tsx`
- Replace wolf emoji + "Parlay Wolf" with the existing `ParlayFarmLogo` component
- Remove "Sign In" link
- Add success state: when `?success=true` is in URL, show a message with link to Telegram bot

### 3. No-Auth Checkout -- `src/components/bot-landing/PricingCard.tsx`
- Add an email input field above the "Join Now" button
- Pass email to checkout function directly (no auth needed)
- Basic email validation

### 4. Edge Function -- `supabase/functions/create-bot-checkout/index.ts`
- Remove auth requirement (accept `{ email }` from request body instead)
- Set `success_url` to `https://t.me/parlayiqbot`
- Keep `cancel_url` pointing back to `/`

### 5. Config -- `supabase/config.toml`
- Set `verify_jwt = false` for `create-bot-checkout` so it can be called without authentication

### 6. Subscription Hook -- `src/hooks/useSubscription.ts`
- Update `startBotCheckout` to accept an email parameter and call the function without requiring auth session

## Technical Details

### create-bot-checkout (updated logic)
```
// No auth header needed
const { email } = await req.json();
if (!email) throw new Error("Email is required");

const session = await stripe.checkout.sessions.create({
  customer_email: email,
  line_items: [{ price: "price_1T1HU99D6r1PTCBBLQaWi80Z", quantity: 1 }],
  mode: "subscription",
  success_url: "https://t.me/parlayiqbot",
  cancel_url: `${req.headers.get("origin")}/`,
});
```

### PricingCard (email input)
- Simple text input with email validation
- "Join Now" button calls checkout with the entered email
- No account creation, no password

### Route Map
```
/        --> BotLanding (public homepage)
/bot     --> Redirect to /
/admin   --> Admin dashboard (auth-protected)
```

