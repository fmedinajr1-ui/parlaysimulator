

# Fix: "Sending undefined notification" in Matchup Broadcast

## Problem
`nba-matchup-daily-broadcast` sends a pre-formatted message string directly to `bot-send-telegram`:
```typescript
body: { message, bypass_quiet_hours: true }
```

But `bot-send-telegram` expects `{ type, data }` and destructures accordingly (line 1521). Since there's no `type` or `data`, it logs "Sending undefined notification" and calls `formatMessage(undefined, undefined)`, which hits the default case and returns `📌 Bot Update: undefined` instead of the actual matchup report.

## Fix

**File: `supabase/functions/bot-send-telegram/index.ts`** (~line 1520-1524)

Add a check for raw `message` payloads. If the request body has a `message` field (and no `type`), skip formatting and send the raw text directly:

```typescript
const reqBody = await req.json();
const adminOnly = reqBody.admin_only === true;

// Handle raw message passthrough (used by matchup broadcast, etc.)
if (reqBody.message && !reqBody.type) {
  const message = reqBody.message;
  // Send directly to admin, skip formatMessage
  // ... send via sendToTelegram(message) ...
}

const { type, data: rawData }: NotificationData = reqBody;
```

This requires restructuring the handler slightly so the `sendToTelegram` helper and quiet-hours/bypass logic are accessible for both paths. The simplest approach: extract `sendToTelegram` before the branching, then for raw messages, skip formatting and notification preferences, just send.

**File: `supabase/functions/nba-matchup-daily-broadcast/index.ts`** — No changes needed. The raw message format is fine; the telegram function just needs to handle it.

## Summary
One file changed: `bot-send-telegram/index.ts` — add raw message passthrough so pre-formatted broadcasts arrive as-is.

