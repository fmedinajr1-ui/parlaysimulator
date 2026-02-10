

# Add "Fix" Buttons to Diagnostic Report

## Overview

When the daily diagnostic Telegram report shows failures, add inline buttons below the message that let you trigger fixes directly from the chat. Each failed check gets a corresponding "Fix" button that calls the right backend function.

## What Changes

### 1. Update `bot-send-telegram` -- add inline keyboard to diagnostic reports

The `formatDiagnosticReport` function currently returns just a text string. The Telegram send logic needs to also return an `inline_keyboard` when the report contains failures.

Mapping of failed checks to fix actions:

| Failed Check | Button Label | Callback Action |
|---|---|---|
| Data Freshness | Fix: Refresh Props | `fix:refresh_props` |
| Weight Calibration | Fix: Calibrate | `fix:calibrate` |
| Parlay Generation | Fix: Generate Parlays | `fix:generate` |
| Settlement Pipeline | Fix: Settle Parlays | `fix:settle` |
| Cron Jobs | Fix: Run All Jobs | `fix:run_crons` |

Checks like "Blocked Categories" and "Orphaned Data" don't have simple one-click fixes, so they won't get buttons.

The function will return both the message text and an optional `reply_markup` object with the inline keyboard. The send logic will pass this through to the Telegram API.

### 2. Update `telegram-webhook` -- handle `fix:*` callbacks

Extend `handleCallbackQuery` to recognize `fix:` prefixed callback data and trigger the appropriate edge function:

- `fix:refresh_props` -- calls `engine-cascade-runner` (or `refresh-todays-props`)
- `fix:calibrate` -- calls `calibrate-bot-weights`
- `fix:generate` -- calls `bot-generate-daily-parlays`
- `fix:settle` -- calls `bot-settle-and-learn`
- `fix:run_crons` -- runs calibrate + settle + generate in sequence

Each fix action will:
1. Answer the callback query with "Running fix..."
2. Send a status message: "Running [fix name]..."
3. Call the edge function
4. Send a result message with success/failure

### 3. Update `bot-daily-diagnostics` -- pass failure data to Telegram

The diagnostics function already sends the full `checks` array to telegram. No changes needed here -- the `bot-send-telegram` function will read the check statuses to determine which buttons to show.

## Technical Details

### `bot-send-telegram` changes

- Refactor `formatDiagnosticReport` to return `{ text: string, reply_markup?: object }` instead of just a string
- Update the main handler to detect when a formatter returns an object with `reply_markup` and pass it to the Telegram API
- Build the inline keyboard dynamically based on which checks have `status: 'fail'` or `status: 'warn'`

### `telegram-webhook` changes

- Add `fix:` handling branch in `handleCallbackQuery`
- Create a `handleFixAction(action, chatId)` helper that maps action names to edge function URLs
- Each fix calls the corresponding function via `fetch()` with the service role key
- Report back with success/error message

### Files modified
1. `supabase/functions/bot-send-telegram/index.ts` -- diagnostic format + send logic
2. `supabase/functions/telegram-webhook/index.ts` -- callback handler for fix actions

