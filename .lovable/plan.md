

## Fix MarkdownV2 Escaping in Telegram Announcement

### Problem
The announcement failed to send to all 6 active customers because Telegram's MarkdownV2 format requires escaping special characters like `!`, `?`, `—`, and leading `—`. The current message has unescaped `!`, `?`, and `—` characters.

### Fix
**File:** `supabase/functions/bot-announce-strategy-update/index.ts`

Update the `ANNOUNCEMENT_MESSAGE` string to properly escape all MarkdownV2 reserved characters:

- `Hey!` → `Hey\\!`
- `— but` → `\\— but`  
- `— if` → `\\— if`
- `Questions?` → `Questions\\?`
- `— Parlay Bot Team` → `\\— Parlay Bot Team`

These are the 5 unescaped special characters causing the Telegram API to reject the message.

### After Fix
Redeploy the function and invoke it again to send the announcement to all 6 active customers.

