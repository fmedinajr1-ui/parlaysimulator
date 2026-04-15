

# Fix Straight Bet Slate — Telegram Message Not Sending

## Problem
The 45 bets were created in the database but the Telegram message failed with:
> `Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 25`

**Root causes:**
1. **Team cascades leaking in** — entries like "TEAM CASCADE (Justin Crawford, Edmundo Sosa)" are team-level signals, not individual player bets. The function has no filter for these.
2. **Markdown breaking** — Parentheses `()` inside `*bold*` markers confuse Telegram's Markdown parser. Player names like "Max Muncy (2002)" break formatting.

## Fix

### 1. Filter out team cascades in `straight-bet-slate/index.ts`
Skip any alert where `player_name` starts with "TEAM CASCADE" — these are team-level signals, not bettable individual props.

### 2. Fix Markdown formatting
- Escape or strip parentheses from player names before inserting into `*bold*` blocks
- Switch from `Markdown` to `MarkdownV2` parse mode with proper escaping, OR simply use `HTML` parse mode which handles special chars better

### 3. Clean up today's bad data
- Delete all `straight_bet_tracker` rows for today
- Re-invoke the function after deploying fixes

### 4. Re-send to Telegram
After cleanup + redeploy, invoke the function to generate a clean slate with only individual player bets.

## Files
- `supabase/functions/straight-bet-slate/index.ts` — add team cascade filter + fix message formatting

