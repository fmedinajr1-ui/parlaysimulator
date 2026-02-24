

## Auto-Generated One-Time Password on Stripe Success Page

### What This Solves
Customers pay via Stripe but currently get redirected to the Telegram bot URL with no access password. They have to manually get a password from somewhere. This change auto-generates a unique, single-use password at checkout time and shows it on a success page so they can immediately unlock the bot.

### How It Works
1. Customer pays via Stripe
2. Stripe redirects them to a new `/bot-success` page (instead of directly to Telegram)
3. That page shows their one-time password and a link to the Telegram bot
4. The password only works once -- it can't be copied and shared with others

### Changes

#### 1. Modify `create-bot-checkout` Edge Function
- After creating the Stripe checkout session, generate a random 8-character alphanumeric password
- Insert it into `bot_access_passwords` with `max_uses: 1` and `created_by: 'stripe_checkout'`
- Store the password ID in the Stripe session metadata so it can be retrieved later
- Change the `success_url` to point to `/bot-success?session_id={CHECKOUT_SESSION_ID}` instead of the Telegram bot URL

#### 2. Create New `retrieve-bot-password` Edge Function
- Accepts a Stripe `session_id`
- Verifies payment was completed via Stripe API
- Looks up the password ID from the session metadata
- Returns the password text (only once -- marks it as "retrieved" after first access)
- This prevents the password from being accessed multiple times by refreshing the page

#### 3. Add `retrieved` Column to `bot_access_passwords` Table
- New boolean column `retrieved` (default `false`)
- The `retrieve-bot-password` function sets this to `true` after the first retrieval
- Subsequent requests return a "already shown" message instead of the password

#### 4. Create `/bot-success` Page
- New page component at `src/pages/BotSuccess.tsx`
- On load, reads `session_id` from URL params
- Calls `retrieve-bot-password` to get the one-time password
- Displays:
  - Success confirmation with checkmark
  - The password prominently (large, clear text)
  - Instructions: "Open @parlayiqbot on Telegram and send `/start [password]`"
  - Direct link to the Telegram bot
  - Warning: "This password will only be shown once and works for one person only"
- If password was already retrieved, shows a message directing them to contact support
- Add route to `App.tsx`

### Technical Details

**Password Generation**: Random 8-char alphanumeric string (e.g., `xK9mP2qR`) generated server-side in the edge function using `crypto.getRandomValues()`

**Security Flow**:
```text
Stripe Checkout --> success_url with session_id
       |
       v
/bot-success page --> calls retrieve-bot-password
       |
       v
Edge function: verify payment + return password (once only)
       |
       v
User copies password --> sends /start xK9mP2qR to bot
       |
       v
Bot validates: max_uses=1, times_used=0 --> grants access
```

**Files changed**:
- `supabase/functions/create-bot-checkout/index.ts` -- generate password, store in metadata, update success_url
- `supabase/functions/retrieve-bot-password/index.ts` -- new function to securely return password once
- `src/pages/BotSuccess.tsx` -- new success page
- `src/App.tsx` -- add `/bot-success` route
- Database migration: add `retrieved` column to `bot_access_passwords`

