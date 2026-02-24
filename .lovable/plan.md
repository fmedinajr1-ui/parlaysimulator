

## Telegram Slate Status Update -- Voided + Active Parlays

### What This Does
Adds a new notification type `slate_status_update` to the Telegram bot that broadcasts a message to all customers showing:
- How many parlays were voided today (and why they were filtered out)
- The 8 active parlays that are good to go, with leg details
- Clear visual separation between voided summary and active picks

### Changes

#### 1. Add `slate_status_update` Notification Type
**File: `supabase/functions/bot-send-telegram/index.ts`**

- Add `'slate_status_update'` to the `NotificationType` union (line 20-39)
- Add case in `formatMessage` switch to call a new `formatSlateStatusUpdate` function
- Add it to the broadcast list (line 1042) so it goes to all customers, not just admin

**New `formatSlateStatusUpdate` function** formats a message like:

```text
DAILY SLATE STATUS -- Feb 24
================================

VOIDED: 23 parlays filtered by quality gates
Reasons: low probability, redundant legs, exposure limits

ACTIVE PICKS: 8 parlays locked in
--------------------------------

Parlay #1 (cash_lock) -- 3 legs
 Take Al Horford OVER 2.5 AST (70% L10)
 Take Andrew Wiggins OVER 1.5 3PT (100% L10)
 Take Player OVER X.X PROP (XX% L10)

Parlay #2 (mispriced_edge) -- 3 legs
 ...

Use /parlays for full details
```

- Data payload expects: `{ voidedCount, voidedReasons, activeParlays: [...] }`
- Each active parlay shows strategy name, leg count, and each leg with player, side, line, prop, and L10 hit rate

#### 2. Create `bot-slate-status-update` Edge Function
**New file: `supabase/functions/bot-slate-status-update/index.ts`**

This function:
- Queries `bot_daily_parlays` for today's date
- Separates parlays by outcome: `pending` (active) vs `void` (voided)
- Extracts leg details from active parlays (player name, prop type, line, side, hit rate)
- Counts voided parlays
- Sends the formatted payload to `bot-send-telegram` with type `slate_status_update`

Can be triggered manually or added to the pipeline after parlay generation.

### Technical Details

**Files modified:**
- `supabase/functions/bot-send-telegram/index.ts` -- add type, formatter, broadcast
- `supabase/functions/bot-slate-status-update/index.ts` -- new edge function to query and send

**Broadcast:** Added to the customer broadcast list alongside `mega_parlay_scanner`, `daily_winners_recap`, and `slate_rebuild_alert` so all authorized users receive it.

