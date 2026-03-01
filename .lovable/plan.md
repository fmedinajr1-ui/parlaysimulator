

## Admin Approval Flow for Daily Parlays

### Overview
Add an admin review step to the daily parlay pipeline. Instead of auto-broadcasting execution parlays, the system will send them to you via Telegram for approval. You can approve, reject, or edit individual legs (flip over/under) -- all from Telegram inline buttons.

### Workflow
1. Morning generation runs as usual (9 AM ET cron)
2. Execution-tier parlays are saved with `approval_status = 'pending_approval'`
3. You receive a Telegram preview showing each execution parlay with its legs
4. Per parlay, you get: **Approve**, **Edit**, **Reject** buttons
5. Tapping **Edit** shows each leg with a **Flip** button (Over becomes Under, Under becomes Over)
6. After editing, tap **Done** to approve the edited parlay
7. When ready, send `/broadcast` to push all approved parlays to customers
8. Parlays you don't review stay pending (no auto-send)

### Technical Details

**Step 1: Database Migration -- Add `approval_status` to `bot_daily_parlays`**
- Add column: `approval_status TEXT DEFAULT 'auto_approved'`
- Values: `pending_approval`, `approved`, `rejected`, `edited`, `auto_approved`
- Existing parlays keep `auto_approved` so nothing breaks
- Only execution-tier parlays will use `pending_approval`

**Step 2: Update `bot-generate-daily-parlays/index.ts`**
- After inserting execution-tier parlays, set `approval_status = 'pending_approval'`
- After generation completes, call `bot-send-telegram` with new type `parlay_approval_request`
- Pass the execution parlays data so admin gets a preview

**Step 3: Update `bot-send-telegram/index.ts`**
- Add `parlay_approval_request` to the `NotificationType` union
- Add formatter `formatParlayApprovalRequest` that renders each execution parlay with legs and inline buttons:
  ```
  🔍 REVIEW PARLAYS -- Mar 1

  Parlay #1 (execution_elite_6L) +2450
  1. LeBron James OVER 25.5 PTS (72% L10)
  2. Jokic OVER 11.5 REB (68% L10)
  3. Haliburton OVER 8.5 AST (65% L10)

  [Approve] [Edit Legs] [Reject]
  ```
- This type sends to admin only (not in the broadcast list)

**Step 4: Update `telegram-webhook/index.ts` -- Callback Handlers**
Add new callback patterns to `handleCallbackQuery`:

- `approve_parlay:{id}` -- Updates `approval_status = 'approved'`, confirms with checkmark
- `reject_parlay:{id}` -- Updates `approval_status = 'rejected'` and `outcome = 'void'`
- `edit_parlay:{id}` -- Shows each leg with a Flip button:
  ```
  Editing Parlay #1:
  1. LeBron OVER 25.5 PTS [Flip to UNDER]
  2. Jokic OVER 11.5 REB [Flip to UNDER]
  3. Haliburton OVER 8.5 AST [Flip to UNDER]
  [Done - Approve]
  ```
- `flip_leg:{parlay_id}:{leg_index}` -- Reads the parlay's `legs` JSON, flips `side` for that index (over to under / under to over), writes it back, re-renders the edit view
- `approve_all_parlays` -- Bulk approves all `pending_approval` parlays for today

**Step 5: Add `/broadcast` Command**
- New command in `telegram-webhook` (admin-only)
- Queries `bot_daily_parlays` where `parlay_date = today` and `approval_status IN ('approved', 'edited')`
- Formats them using the existing `mega_parlay_scanner` or `slate_status_update` format
- Sends to all active customers in `bot_authorized_users`

**Step 6: Gate Existing Auto-Broadcast**
- In `bot-send-telegram`, modify the broadcast section (line ~1287) to check `approval_status`
- For `slate_status_update` and `mega_parlay_scanner` types, only include parlays where `approval_status IN ('approved', 'edited', 'auto_approved')`
- This prevents unapproved parlays from leaking to customers

### Files Modified
1. **Database migration** -- Add `approval_status` column
2. **`supabase/functions/bot-generate-daily-parlays/index.ts`** -- Set `pending_approval` on execution parlays + trigger admin preview
3. **`supabase/functions/bot-send-telegram/index.ts`** -- Add `parlay_approval_request` type + formatter
4. **`supabase/functions/telegram-webhook/index.ts`** -- Add approve/reject/edit/flip callbacks + `/broadcast` command

