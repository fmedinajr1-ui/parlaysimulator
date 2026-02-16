

# Consolidate Telegram Parlay Messages and Clean Up Display

## Problem (from your screenshot)
- Each parlay is sent as a separate Telegram message, flooding the chat
- Source labels (e.g., "Whale Signal") add clutter -- remove them
- Users want all picks visible in 1-3 clean messages, not 10+ individual ones

## Changes

### 1. Remove Source Labels from `formatLegDisplay()` in `telegram-webhook/index.ts`
Remove the `getSourceLabel()` call from the reasoning line. Keep only Score and Hit Rate:
```
Before: Score: 69 | Hit: 65% | Whale Signal
After:  Score: 69 | Hit: 65%
```

Also remove the `Buffer` field from player props to keep it cleaner.

### 2. Consolidate `/parlays` into 1-3 Messages in `handleParlays()` (`telegram-webhook/index.ts`)
Currently the function shows top 2 per tier inline, then sends a second message with "View Legs" buttons for the rest. Redesign to:

- Pack ALL parlays (legs inline) into a single message, respecting Telegram's 4096 char limit
- If it exceeds 4096 chars, use the existing `sendLongMessage()` to auto-split into 2-3 chunks at line breaks
- Remove the separate "More parlays:" button message entirely
- Remove all inline "View Legs" buttons -- everything is shown directly
- Show up to 5 parlays per tier with all legs visible

Format per parlay:
```
1. premium_boost (3-leg) +450 PENDING
   Take East Texas A&M -1.5 (-110)
   Take UNDER 135.5 (-110)
   Take Murray St -3.5 (-110)
   Avg Score: 74 | Avg Hit: 72%
```

### 3. Update Generation Notification in `bot-send-telegram/index.ts`
In `formatTieredParlaysGenerated()`:
- Remove source labels from top picks preview (Score + Hit only)
- Keep the existing compact preview format (it's just a summary alert)

### 4. Update `legs:` Callback Handler
The callback handler for "View Legs" buttons will still work if someone taps an old button, but new messages won't include these buttons anymore.

## Files Modified
1. `supabase/functions/telegram-webhook/index.ts` -- `formatLegDisplay()` (remove source/buffer), `handleParlays()` (consolidate all into one message)
2. `supabase/functions/bot-send-telegram/index.ts` -- `formatTieredParlaysGenerated()` (remove source labels)

## Result
Instead of 10+ separate messages, you'll get 1-3 clean messages with every pick clearly showing what to take and its score/hit rate.
