

# Fix Cascade Parlay Telegram Broadcast & Re-send

## Problem
The cascade generator sends the 20-ticket slate as a raw `message` to `bot-send-telegram`. This hits the "direct message" shortcut path (line 1184) which sends directly to Telegram **without chunking**. When the slate exceeds Telegram's 4096-char limit, it silently fails.

## Fix

### Edit: `supabase/functions/bot-send-telegram/index.ts`
Add chunking logic to the **direct message** path (lines 1184–1201). After the initial send attempt, if the response contains "message is too long", split on newlines at ~4000 chars and send each chunk separately — same logic already used in the typed message path (lines 1287–1311).

### Re-invoke: `mlb-cascade-parlay-generator`
The 20 tickets already exist in the DB from the earlier regeneration. We just need to re-send the Telegram message. Two options:
1. Call `bot-send-telegram` directly with the slate message
2. Delete today's parlays and re-run the generator (which rebuilds and sends)

Option 1 is cleaner — we'll query the existing tickets and build the message in a quick curl call to `bot-send-telegram`.

**However**, since the generator is the one that builds the formatted message, the simplest fix is: delete today's cascade parlays, deploy the fixed `bot-send-telegram`, then re-invoke the generator.

## Steps
1. **Edit** `bot-send-telegram/index.ts` — add chunking to direct message path
2. **Deploy** `bot-send-telegram`
3. **Delete** today's cascade parlays (migration)
4. **Re-invoke** `mlb-cascade-parlay-generator` — generates fresh slate + sends chunked Telegram message

