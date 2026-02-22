

## Secure Customer Access + Personal Data Commands

### The Problem

1. **Anyone can join the bot** -- no access control for new customers
2. **`/parlay`, `/performance`** show the bot's internal pending summary and bot performance -- customers shouldn't see these
3. **`/calendar`, `/roi`** show the bot's P&L and ROI -- customers need their OWN data from day one

### What Changes

**Change 1: Password-Gated Access for New Users**

Create a `bot_authorized_users` table to track who has access. When a new user sends `/start`:
- Check if their `chat_id` is already in `bot_authorized_users`
- If yes (existing user or already authorized): grant access normally
- If no: prompt them for a password before allowing any commands
- Admin can set passwords via `/setpassword [password]` and grant specific users via `/grantaccess [chat_id]`

All existing bot users (anyone who has activity in `bot_activity_log` before today) will be auto-grandfathered -- no password needed.

**Change 2: Remove `/parlay` and `/performance` from Customer Commands**

- Remove `/parlay` (pending summary) from customer command list and route
- Remove `/performance` (bot win rate/ROI) from customer command list and route
- Both remain available for admin

**Change 3: Personal Calendar from Day One**

Replace the bot's `bot_activation_status` calendar with a personal one:
- Create `customer_daily_pnl` table to track each customer's daily results
- `/calendar` for customers queries their own `customer_daily_pnl` by `chat_id`
- Their "Day 1" is the day they joined (`authorized_at` in `bot_authorized_users`)
- Admin's `/calendar` still shows the bot's global calendar

**Change 4: Personal ROI from Day One**

- `/roi` for customers calculates from `customer_daily_pnl` data for that specific user
- Shows their personal 7-day, 30-day, and all-time stats
- Admin's `/roi` still shows the bot's global ROI

### Database Tables

**`bot_authorized_users`** (new)

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| chat_id | text | Telegram chat ID (unique) |
| username | text | Telegram username (optional) |
| authorized_at | timestamptz | When they gained access |
| authorized_by | text | 'password', 'admin_grant', 'grandfathered' |
| is_active | boolean | Can be revoked |

**`bot_access_passwords`** (new)

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| password | text | The access password |
| created_by | text | Admin chat ID |
| max_uses | integer | How many times it can be used (null = unlimited) |
| times_used | integer | Current usage count |
| is_active | boolean | Can be deactivated |
| created_at | timestamptz | When created |

**`customer_daily_pnl`** (new)

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid | Primary key |
| chat_id | text | Customer's Telegram chat ID |
| pnl_date | date | The date |
| daily_profit_loss | numeric | Their P&L for the day |
| parlays_won | integer | Parlays they won |
| parlays_lost | integer | Parlays they lost |
| parlays_total | integer | Total parlays they tracked |
| created_at | timestamptz | Record timestamp |

### New Admin Commands

- `/setpassword [password]` -- Create a new access password (optionally with max uses: `/setpassword mypass123 10`)
- `/grantaccess [chat_id]` -- Manually authorize a specific user
- `/listusers` -- Show all authorized users
- `/revokeaccess [chat_id]` -- Revoke a user's access

### Access Flow for New Users

```text
New User sends /start
       |
       v
  Is chat_id in bot_authorized_users?
       |
      YES --> Show welcome, grant commands
       |
      NO --> "Welcome! Enter your access password:"
              |
              v
         User types password
              |
              v
         Valid password? --> Add to bot_authorized_users --> Welcome!
              |
             NO --> "Invalid password. Contact admin for access."
```

### Technical Details

**File: `supabase/functions/telegram-webhook/index.ts`**

1. **Add `isAuthorized()` check** -- queries `bot_authorized_users` for the chat_id
2. **Add password state tracking** -- when a new user sends `/start` and isn't authorized, set them in "awaiting password" state. Their next message is checked against `bot_access_passwords`.
3. **Modify `handleMessage` router** (line 2497):
   - Before processing any command, check `isAuthorized(chatId)` (skip for admin)
   - If not authorized and not awaiting password, prompt for password
   - If awaiting password, validate input against `bot_access_passwords`
4. **Remove `/parlay` and `/performance` from customer routes** (lines 2508-2509):
   - Move them inside the admin-only block (after line 2572)
5. **New `handleCustomerCalendar(chatId)`** -- queries `customer_daily_pnl` for that chat_id
6. **New `handleCustomerRoi(chatId)`** -- calculates personal ROI from `customer_daily_pnl`
7. **Split calendar/roi routing**:
   - `/calendar` -> admin gets `handleCalendar()`, customers get `handleCustomerCalendar()`
   - `/roi` -> admin gets `handleRoi()`, customers get `handleCustomerRoi()`
8. **Grandfather existing users** -- on first deploy, a migration inserts all distinct chat_ids from `bot_activity_log` into `bot_authorized_users` with `authorized_by = 'grandfathered'`
9. **New admin command handlers**: `handleSetPassword`, `handleGrantAccess`, `handleListUsers`, `handleRevokeAccess`

**Updated Customer `/start` message:**
```text
Welcome to Parlay Farm!

Commands:
/parlays -- Today's picks
/calendar -- Your monthly P&L
/roi -- Your ROI breakdown
/streaks -- Hot & cold streaks
/help -- All commands
```
(No more `/parlay` or `/performance`)

### Files Modified

1. `supabase/functions/telegram-webhook/index.ts` -- All command routing, authorization, personal data handlers
2. Database migration -- Create 3 new tables + grandfather existing users

