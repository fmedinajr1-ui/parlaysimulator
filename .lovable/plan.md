

# Remove Web App Links from Telegram Messages

## Problem
Telegram bot messages contain links back to `parlaysimulator.lovable.app` — users should get all their info directly in Telegram, not be redirected to a web dashboard.

## Changes

### 1. `supabase/functions/bot-send-telegram/index.ts`
Remove two "View Dashboard" links:
- **Line 95** in `formatParlaysGenerated`: Remove `[View Dashboard](https://parlaysimulator.lovable.app/)`
- **Line 115** in `formatTieredParlaysGenerated`: Remove `[View Dashboard](https://parlaysimulator.lovable.app/)`

### 2. `supabase/functions/telegram-webhook/index.ts`
Remove three web links from command responses:
- **Line 418** in `/calendar` empty state: Remove the `View full calendar` link
- **Lines 456-457** in `/calendar` results: Remove `View full calendar` link
- **Line 1355** in `/performance` response: Remove `View dashboard` link

### 3. `supabase/functions/send-parlay-alert/index.ts` (Optional - Email Only)
This file has links in email notifications (not Telegram). These will be left as-is since email users may still want web links. If you want those removed too, let me know.

## Scope
- 5 link removals across 2 edge functions
- Redeploy `bot-send-telegram` and `telegram-webhook`
- No database changes needed

