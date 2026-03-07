

## Plan: Remove Slip Analyzer from Landing Page + Add to Telegram Bot

### Part 1: Remove from BotLanding.tsx
- Remove `HomepageAnalyzer` import and `<HomepageAnalyzer />` usage from `src/pages/BotLanding.tsx` (line ~13 and ~164)
- Keep it on `Index.tsx` (the main homepage) unless you want it removed there too

### Part 2: Add Photo Handler to Telegram Webhook
The webhook currently only handles `update.message.text`. We need to add a `update.message.photo` handler that:

1. **Detects photo messages** from authorized users
2. **Downloads the photo** via Telegram `getFile` API → `https://api.telegram.org/file/bot{token}/{file_path}`
3. **Converts to base64** and calls the existing `extract-parlay` edge function (the same one the web UI uses)
4. **Formats results** as a Telegram message showing:
   - Detected legs with player/prop/line/odds
   - Quick simulation (EV, probability)
   - Sweet spot cross-reference for any matching legs
5. **Sends back** the analysis to the user's chat

### Changes

**`src/pages/BotLanding.tsx`** — Remove `HomepageAnalyzer` import and component

**`supabase/functions/telegram-webhook/index.ts`** — Add:
- New `handlePhotoMessage(chatId, fileId)` function
- Photo detection block in the main handler (before text handler): check `update.message.photo`, get largest photo's `file_id`, call handler
- Auth check: only respond if user is in `bot_authorized_users`
- Download photo → base64 → invoke `extract-parlay` → format legs → optional sweet spot lookup → send response

### No database changes needed.

