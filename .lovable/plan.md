

## Add `/admin` Command with Approval Dashboard

### Problem
The `/admin` command isn't registered as a Telegram command. It falls through to the AI natural language handler, which generates an outdated "ADMIN DASHBOARD" response without the new approval flow controls.

### Solution
Add a dedicated `/admin` command handler that shows:
1. Today's parlay approval status summary (pending, approved, rejected, edited counts)
2. Inline buttons for quick actions: Review Pending, Approve All, Broadcast
3. Each pending parlay listed with Approve/Edit/Reject buttons

### Technical Details

**File: `supabase/functions/telegram-webhook/index.ts`**

1. **Create `handleAdminDashboard(chatId)` function** (~line 2090 area, near other admin handlers)
   - Query `bot_daily_parlays` for today's date
   - Group by `approval_status` to get counts (pending, approved, rejected, edited, auto_approved)
   - Format a dashboard message showing:
     ```
     🤖 ADMIN DASHBOARD -- Mar 1
     ━━━━━━━━━━━━━━━━━━━━━
     
     📊 Today's Parlays:
      - Pending: 5
      - Approved: 3
      - Rejected: 1
      - Edited: 2
     
     Quick Actions:
     ```
   - Add inline keyboard buttons:
     - `[📋 Review Pending]` -> callback `review_pending_parlays`
     - `[✅ Approve All]` -> callback `approve_all_parlays`
     - `[📢 Broadcast Approved]` -> callback `trigger_broadcast`
   - If there are pending parlays, list each one with Approve/Edit/Reject buttons (reusing the existing approval message format)

2. **Register the command** (~line 3107, before admin-only operational commands)
   - Add: `if (cmd === "/admin") { await handleAdminDashboard(chatId); return null; }`

3. **Add `review_pending_parlays` callback handler** (~line 2470 area, near existing approval callbacks)
   - Fetches all `pending_approval` parlays for today
   - Sends each one as a separate message with Approve/Edit/Reject inline buttons (same format as `parlay_approval_request`)

4. **Add `trigger_broadcast` callback handler**
   - Calls the existing `handleBroadcast` function

### Files Modified
- `supabase/functions/telegram-webhook/index.ts` -- Add `handleAdminDashboard`, register `/admin` command, add new callback handlers
