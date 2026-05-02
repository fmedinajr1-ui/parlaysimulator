## Why a new subscriber couldn't access Telegram

After tracing every step of the signup → Telegram pipeline, three concrete bugs are blocking new subscribers:

1. **Pup tier (free) creates no account.** `create-free-signup` opens a Stripe `setup` checkout but never:
   - creates a Supabase auth user / `profiles` row,
   - generates a `bot_access_passwords` entry (Stripe metadata has no `password_id`),
   - inserts a row in `email_subscribers`.
   
   So when the user hits `/bot-success`, `retrieve-bot-password` throws "No password associated with this session." And later when they try `/link <email>` in Telegram, the scanner doesn't find a profile → "I couldn't find an account."

2. **No `/start <password>` handler exists in the bot.** `BotSuccess.tsx` instructs users: "Send `/start <password>` to @parlayiqbot." `telegram-prop-scanner` only treats `/start` as a help alias and ignores the argument. There is no code anywhere that reads `bot_access_passwords`, marks the chat as `authorized_by='password'`, and inserts into `bot_authorized_users`. (Existing rows with `authorized_by='password'` came from a previous handler that has since been deleted.)

3. **No welcome / greeting message is sent on signup completion.** The Stripe webhook only handles `checkout.session.completed` for scan-credit top-ups — it never fires `send-bot-access-email`, never DMs the new user on Telegram, and never notifies the admin. So a new subscriber pays, sees the password page, tries the bot, gets nothing back.

## What we'll change

### A. Pup signup creates a real account + password (server side)
Edit `create-free-signup`:
- Generate a one-time access password and insert into `bot_access_passwords` (same shape `create-bot-checkout` uses).
- Create the Supabase auth user (`admin.createUser` with `email_confirm: true`, random secure password) so `/link <email>` resolves a profile. Upsert into `profiles` if a trigger doesn't already do it.
- Upsert `email_subscribers` with `source='pup_signup'`, `is_subscribed=true`.
- Pass `password_id`, `tier=pup`, and `email` in Stripe session metadata so `BotSuccess` and the webhook both work.

### B. Add the missing `/start <password>` handler in `telegram-prop-scanner`
In the existing command router:
- If text matches `/start <8-12 char token>`, look it up in `bot_access_passwords`. If valid and not yet bound to another chat:
  - Insert/upsert `bot_authorized_users` row with `chat_id`, `username`, `authorized_by='password'`, `is_active=true`.
  - Mark the password as `redeemed_chat_id=<chat_id>` (new column or reuse `retrieved`).
  - If we know the email from the originating Stripe session, also upsert `email_subscribers.telegram_chat_id` so all downstream broadcasts find them.
  - Send the **greeting message** (welcome + how to use `/parlay`, `/scan`, `/book`).
- If invalid: friendly error explaining how to get a password.
- Keep `/start` (no arg) and `/help` as today.

### C. Stripe webhook fires welcome email + admin notify on every signup
Extend `stripe-webhook`'s `checkout.session.completed` branch:
- Read `session.metadata.tier` and `session.metadata.email`.
- For `tier in ('pup','top_dog','kennel_club')`:
  - Invoke `send-bot-access-email` with the customer's email (greeting + bot link + reminder to send `/start <password>`).
  - Send an admin Telegram notification ("🆕 New signup: …").
- This guarantees a greeting goes out the moment Stripe confirms the session, regardless of whether the user opened the success page.

### D. `send-bot-access-email` includes the password
Tweak the email template to include the user's `/start <password>` line with copy-button-friendly formatting, so even users who close the success page can still activate.

### E. Verify Resend sender setup before relying on it
`send-bot-access-email` is currently hard-coded to `from: ParlayIQ <onboarding@resend.dev>`. That sandbox sender only delivers to the Resend account owner's verified email — which is almost certainly why the new subscriber never received anything. We will:
- Check that `RESEND_API_KEY` is configured.
- Switch the `from` address to a verified custom domain (e.g. `noreply@parlayfarm.com`) **only if** that domain is verified in Resend; otherwise leave a clear admin-only Telegram warning so it's obvious why emails aren't going out.

(If the user prefers, we can swap to the built-in Lovable transactional email system instead of Resend — happy to do that as a follow-up.)

## Verification (5 manual tests, per project rule)

1. **Pup signup, full flow** — sign up with a brand-new email, complete Stripe setup, confirm `/bot-success` shows a password, confirm welcome email arrives, confirm `/start <password>` in `@parlayiqbot` returns the greeting.
2. **Top-Dog signup** — same flow, end up in `bot_authorized_users` with `is_active=true`.
3. **Re-use of password** — sending the same `/start <password>` from a second chat is rejected.
4. **`/link <email>` still works** for users who lose the password but already have a profile.
5. **Admin notification** — confirm the admin chat receives "🆕 New signup" within seconds of Stripe completion.

## Files touched

- `supabase/functions/create-free-signup/index.ts` (account + password + metadata)
- `supabase/functions/telegram-prop-scanner/index.ts` (add `/start <password>` handler + greeting)
- `supabase/functions/stripe-webhook/index.ts` (fire welcome email + admin notify on signup)
- `supabase/functions/send-bot-access-email/index.ts` (include password, sender domain check)
- Migration: optional `redeemed_chat_id` column on `bot_access_passwords`.

No schema breaking changes; everything is additive.