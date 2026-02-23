

## Telegram Customer Manager — Bot Dashboard

### Overview

Add a new **"Customers"** tab to the Bot Dashboard (alongside Overview, Parlays, Analytics, War Room) with full admin control over Telegram users.

### New Component

**`src/components/bot/TelegramCustomerManager.tsx`**

A card-based UI that queries `bot_authorized_users` and shows:

- **Stats bar** — Total customers, active count, auth method breakdown (password / admin_grant / grandfathered)
- **Search** — Filter by username or chat ID
- **Customer list** — Each row shows:
  - Telegram username (or chat ID if no username)
  - Auth method badge (colored: green for grandfathered, blue for password, purple for admin_grant)
  - Joined date (relative, e.g. "3 days ago")
  - Active/inactive toggle switch
  - Delete button (with confirmation dialog)
- **Grant access** — Input field + button to add a new customer by chat ID

### Actions available per user

| Action | What it does |
|--------|-------------|
| Toggle active | Updates `is_active` on `bot_authorized_users` — inactive users can't use commands or receive broadcasts |
| Delete | Removes the row entirely from `bot_authorized_users` |
| Grant access | Inserts a new row with `authorized_by: 'admin_grant'` |

### Dashboard Integration

**`src/pages/BotDashboard.tsx`**

- Add a 5th tab: **"Customers"** with a Users icon
- Place `TelegramCustomerManager` inside the new tab content

```text
Tabs: Overview | Parlays | Analytics | War Room | Customers
```

### Technical Details

| File | Change |
|------|--------|
| `src/components/bot/TelegramCustomerManager.tsx` | New — full CRUD UI for `bot_authorized_users` |
| `src/pages/BotDashboard.tsx` | Add Customers tab + import component |

No database changes needed — `bot_authorized_users` table already has all required columns (`chat_id`, `username`, `authorized_by`, `is_active`, `authorized_at`). RLS is handled by the admin role check already in the dashboard.

