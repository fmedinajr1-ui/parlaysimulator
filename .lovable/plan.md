

## Plan: Email Mapping Fix + Lookup Explainer

### Part 1: Fix Email Mapping in `create-checkout`

**Problem:** The `create-checkout` edge function (the original checkout flow) does NOT save the customer's email to `bot_access_passwords`, so when users activate via `/start`, the email-to-chat_id mapping never happens. The newer `create-bot-checkout` already does this correctly.

**Fix:** In `supabase/functions/create-checkout/index.ts`, add `email: user.email` to the password insert (line ~53-58), matching how `create-bot-checkout` does it.

---

### Part 2: Add Matchup Explainer to `/lookup` Output

**What it does:** Add a brief legend below the matchup section in the `/lookup` command output so customers understand what the defense and offense rankings mean.

**Changes in `supabase/functions/telegram-webhook/index.ts`** (around line 3637-3644):

After the existing defense/offense section, append a short explainer block:

```
ℹ️ Defense = what opponent ALLOWS (higher rank = easier matchup)
ℹ️ Offense = opponent's own scoring strength
⚠️ = Top 5 (tough) | 🔥 = Rank 20+ (favorable)
```

This will be appended to the `defenseSection` string so it appears right after the matchup data.

---

### Technical Details

**File changes:**

1. **`supabase/functions/create-checkout/index.ts`** -- Add `email: user.email` to the `bot_access_passwords` insert object
2. **`supabase/functions/telegram-webhook/index.ts`** -- Append 3-line explainer to the `defenseSection` string after the offense stats (around line 3644)

Both edge functions will be redeployed automatically.

