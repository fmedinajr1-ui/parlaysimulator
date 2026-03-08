

## Daily Bankroll Check-In System

### Problem
Customers and admin set their bankroll once, but it's never re-confirmed. Stake sizes on broadcasts don't adapt to daily budget changes. No prompt exists to ask "what's your bankroll today?" before parlays go out.

### Solution: Morning Bankroll Check-In Flow

**1. Add `bankroll_confirmed_date` column to `bot_authorized_users`**
- Tracks the last date each user confirmed their bankroll
- If not today, the system knows to prompt them

**2. Morning Bankroll Prompt (Cron-triggered)**
- New edge function `bot-daily-bankroll-checkin` runs at **9:30 AM ET** (before first parlay broadcast)
- For every active customer + admin whose `bankroll_confirmed_date` != today:
  - Sends a Telegram message: "Good morning! What's your bankroll for today? Reply with `/bankroll [amount]` or tap 'Keep $X' to use yesterday's."
  - Includes inline keyboard: `Keep $[current]` | `Update`
- When user taps "Keep", auto-confirms today's date. When they reply `/bankroll 1500`, it updates and confirms.

**3. Update `/bankroll` command**
- After setting the new amount, also set `bankroll_confirmed_date = today`

**4. Gate broadcasts on bankroll confirmation**
- In `handleBroadcast`: before sending to a customer, check if their bankroll is confirmed for today
- If not confirmed, send the check-in prompt first, then queue them for a delayed send (or skip with a warning to admin)
- This ensures every customer gets stake sizes based on a confirmed daily budget

**5. Personalized stake sizing in broadcast messages**
- Already partially exists (lines 1657-1660 in `bot-send-telegram`) but only for strategy-specific broadcasts
- Extend `handleBroadcast` (lines 2490-2499) to include personalized stakes per customer based on their confirmed bankroll and tier percentages:
  - Execution: 5%, Validation: 2.5%, Exploration: 1%, Lottery: 0.5%

**6. Admin sync**
- Admin's `/bankroll` or UI bankroll update also sets `bankroll_confirmed_date = today`
- The morning prompt goes to admin too

### Files to Change
- **Migration**: Add `bankroll_confirmed_date DATE` to `bot_authorized_users`
- **New function**: `supabase/functions/bot-daily-bankroll-checkin/index.ts`
- **Edit**: `supabase/functions/telegram-webhook/index.ts` — update `/bankroll` handler + callback for "Keep" button + gate broadcast
- **Cron**: Schedule `bot-daily-bankroll-checkin` at 13:30 UTC (9:30 AM ET)

### Stake Sizing Logic
```text
Customer bankroll = $2,000

Execution tier  → $100/parlay  (5%)
Validation tier → $50/parlay   (2.5%)
Exploration tier→ $20/parlay   (1%)
Lottery tier    → $10/parlay   (0.5%)

Smaller bankroll ($500):
Execution → $25, Validation → $12, Exploration → $5, Lottery → $2
```
Scales proportionally — smaller budgets get smaller stakes automatically.

