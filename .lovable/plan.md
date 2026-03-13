

## Problem

The integrity alert (screenshot) shows "Run /admin cleanup to remove bad parlays" as plain text. There are no interactive Telegram buttons — just a static message. The user expects tappable action buttons to auto-void the bad parlays.

## Root Cause

`formatIntegrityAlert` (line 1007-1028 in `bot-send-telegram/index.ts`) returns a plain string. Other formatters like `formatDiagnosticReport` return `{ text, reply_markup }` with inline keyboard buttons. The integrity alert has no `reply_markup`.

## Fix

**File: `supabase/functions/bot-send-telegram/index.ts`**

Update `formatIntegrityAlert` to return an object with inline keyboard buttons instead of a plain string:

1. Add a "Void Bad Parlays" button with callback `integrity_void_bad` that will auto-void all parlays with < 3 legs for the given date
2. Add a "View /admin" button with callback `admin_status` to open the admin dashboard
3. Return `{ text: msg, reply_markup: { inline_keyboard } }` instead of plain `msg`

**File: `supabase/functions/bot-telegram-webhook/index.ts`** (or wherever callback queries are handled)

Add a handler for the `integrity_void_bad` callback that:
- Queries `bot_daily_parlays` for today where `leg_count < 3` and `outcome = 'pending'`
- Updates their `outcome` to `'voided'`
- Sends a confirmation message back with the count of voided parlays

