

## Send HRB Longshots to Admin via Telegram

### What We'll Do
Modify the `fetch-hardrock-longshots` function to optionally fetch + format + send results directly to the admin Telegram chat. Since `bot-send-telegram` already sends to only the admin by default (broadcasting only happens for specific types like `mega_parlay_scanner`), we just need to:

1. **Update `fetch-hardrock-longshots`** to accept an optional `send_telegram: true` flag
2. When enabled, format the longshots into a clean Telegram message and call `bot-send-telegram` with a non-broadcast type (e.g. `diagnostic_report` or a new admin-only type)
3. Invoke the function immediately to send results

### Technical Details

**File modified: `supabase/functions/fetch-hardrock-longshots/index.ts`**

- Parse request body for `{ send_telegram?: boolean }`
- After collecting longshots, if `send_telegram` is true:
  - Format a MarkdownV2 message with header, each pick (game, market, line, odds), sorted by highest odds first
  - Call `bot-send-telegram` with type `diagnostic_report` (admin-only, no customer broadcast)
  - The message format will look like:
    ```
    🎰 HRB LONGSHOTS (+650 and up)
    
    +1000 | Spurs ML
    Spurs @ Knicks
    
    +700 | Mavericks ML
    Thunder @ Mavericks
    
    +650 | Jared McCain O0.5 Blocks
    Thunder @ Mavericks
    ```
- No new files needed -- `bot-send-telegram` already handles admin-only delivery for non-broadcast types

