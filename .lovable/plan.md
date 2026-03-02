
# Cancel Past-Due Subscriptions and Build Email-to-Chat-ID Mapping

## Part 1: Cancel 5 Past-Due Stripe Subscriptions

Use the Stripe `cancel_subscription` tool to cancel all 5 subscriptions:

| Subscription ID | Customer ID |
|---|---|
| `sub_1T4piq9D6r1PTCBB1T9i7KhR` | `cus_U2vGsCpYLHVtUh` |
| `sub_1T4pQw9D6r1PTCBBUM6YZxu2` | `cus_U2vGsCpYLHVtUh` |
| `sub_1T4pPz9D6r1PTCBBNBNVolY5` | `cus_U2vGsCpYLHVtUh` |
| `sub_1T4Ozz9D6r1PTCBBKQygnJ0q` | `cus_U2TxE5KnFpgMgR` |
| `sub_1T46Hg9D6r1PTCBBz6eaCnMd` | `cus_U2AcL9SybwXXHt` |

Note: 3 of the 5 belong to the same customer (`cus_U2vGsCpYLHVtUh`). Since there's no email-to-chat_id mapping yet, we cannot automatically deactivate the corresponding bot users. After Part 2 is built, the webhook will handle future cancellations automatically.

For now, if you can identify which chat_ids belong to these customers, I can manually deactivate them.

---

## Part 2: Build Email-to-Chat-ID Mapping

### The Problem
The `email_subscribers` table exists with `telegram_chat_id` and `email` columns but is empty. The Stripe webhook's auto-deactivation logic looks up `email_subscribers` to find the chat_id for a cancelled customer -- so it always fails.

The missing link: during checkout, the customer provides their email. During bot activation (`/start <password>`), the bot knows the chat_id. But nothing connects the two.

### The Solution

**Add `email` column to `bot_access_passwords` table** so the checkout email is stored alongside the password. When the user activates via `/start <password>`, the bot can read the email from the password record and insert into `email_subscribers`.

### Database Migration

Add an `email` column to `bot_access_passwords`:

```sql
ALTER TABLE public.bot_access_passwords ADD COLUMN email text;
```

### Edge Function Changes

**1. `create-bot-checkout/index.ts`** -- Store email on the password record

When inserting into `bot_access_passwords`, include the customer's email:

```typescript
.insert({
  password,
  created_by: "stripe_checkout",
  is_active: true,
  max_uses: 1,
  email: email,  // <-- NEW: store checkout email
})
```

**2. `telegram-webhook/index.ts`** -- Map email to chat_id during `/start` activation

In `tryPasswordAuth()`, after successfully authorizing the user, check if the password record has an email. If so, upsert into `email_subscribers`:

```typescript
// After successful authorization upsert...
if (pwRecord.email) {
  await supabase.from("email_subscribers").upsert({
    email: pwRecord.email,
    telegram_chat_id: chatId,
    telegram_username: username || null,
    is_subscribed: true,
    source: "bot_activation",
    subscribed_at: new Date().toISOString(),
  }, { onConflict: "email" });
}
```

**3. `stripe-webhook/index.ts`** -- Already handles deactivation

The existing `customer.subscription.deleted` handler already:
1. Looks up customer email from Stripe
2. Finds `telegram_chat_id` via `email_subscribers`
3. Sets `is_active = false` in `bot_authorized_users`

No changes needed here -- it will start working once `email_subscribers` has data.

### Flow After Implementation

```text
Checkout:  email --> bot_access_passwords.email
Activation: /start <pw> --> reads pw.email --> inserts email_subscribers(email, chat_id)
Cancellation: webhook --> Stripe customer email --> email_subscribers.chat_id --> deactivate bot_authorized_users
```

### Deployment

1. Run database migration (add `email` column)
2. Deploy `create-bot-checkout` (stores email on password)
3. Deploy `telegram-webhook` (maps email to chat_id on activation)
4. Cancel all 5 past_due subscriptions via Stripe tools
