

# Admin-Only Preview Before Customer Broadcast

## What Changes

### 1. Add `admin_only` flag to `bot-send-telegram` (line ~1613)
Add a check for `admin_only` in the request body. When `true`, skip the customer broadcast loop entirely — only send to the admin chat ID.

```
const adminOnly = body.admin_only === true;

if (!adminOnly && (type === 'mega_parlay_scanner' || type === 'mega_lottery_v2' || ...)) {
  // broadcast to customers
}
```

### 2. Add `admin_only` passthrough in `bot-generate-daily-parlays`
Accept `admin_only` from the request body and forward it to every `bot-send-telegram` call (~lines 9205, 9244, 9289, 10244, 10347). This way you can trigger generation with `{ "admin_only": true }` and all Telegram messages only go to you.

### 3. Workflow
- **Step 1**: Trigger generation with `admin_only: true` → parlays are written to DB and sent only to your Telegram
- **Step 2**: After you verify, use the existing `/broadcast` command or re-trigger with `admin_only: false` to push to customers

### Files Changed
1. **`supabase/functions/bot-send-telegram/index.ts`** — Gate customer broadcast behind `admin_only` flag
2. **`supabase/functions/bot-generate-daily-parlays/index.ts`** — Pass `admin_only` through to all telegram calls

