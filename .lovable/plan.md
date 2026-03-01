

## Apply Approval Flow to ALL Generated Parlays

### What Changes
Currently, only execution-tier parlays (elite, cash_lock, conviction, etc.) are set to `pending_approval`. All other tiers are inserted with the default `auto_approved` status, meaning they could be broadcast without your review.

This change removes the execution-tier filter so that **every parlay** generated gets sent to you for approval before it reaches customers.

### Technical Details

**File: `supabase/functions/bot-generate-daily-parlays/index.ts` (~lines 9052-9100)**

1. **Remove the execution-tier filter** -- Instead of filtering `allParlays` down to execution strategies, simply set `pending_approval` on ALL inserted parlays for the target date
2. **Simplify the update query** -- Change from `.in('strategy_name', executionParlays.map(...))` to just `.eq('parlay_date', targetDate)` so all parlays for that date get flagged
3. **Send ALL parlays to admin for review** -- The Telegram approval request will include every generated parlay, not just execution ones

The callback handlers in `telegram-webhook` (approve, reject, edit, flip, broadcast) already work on a per-parlay basis using IDs, so they need no changes.

### Before vs After

**Before:** Only ~6-8 execution-tier parlays require approval; research/analysis parlays auto-approve and could leak to broadcast.

**After:** Every single generated parlay starts as `pending_approval`. Nothing reaches customers until you explicitly approve or broadcast.
