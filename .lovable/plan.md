

# Customer Hedge Recommendation Notifications

## Current State
- **Admin-only hedge tracking** exists via `hedge-live-telegram-tracker` — sends pre-game scouts and live hedge updates to the admin Telegram channel only
- **Push notification infrastructure** exists (`send-push-notification`, `push_subscriptions` table, `usePushNotifications` hook, `PushNotificationToggle` component) — but only for sharp money alerts
- **Notification preferences** exist (`NotificationPreferences` component, `notification_preferences` table) — no hedge-specific toggles
- **Customer hedge UI** exists (`CustomerHedgePanel`, `CustomerHedgeIndicator`) — shows live hedge statuses in the Scout War Room but no proactive notifications

## What to Build

### 1. Add hedge notification preference toggles
**File**: `src/components/profile/NotificationPreferences.tsx`
- Add a new "Hedge Alerts" section with two toggles:
  - `push_hedge_alerts` — push notifications for HEDGE ALERT / HEDGE NOW status changes
  - `email_hedge_summary` — post-game hedge summary email
- Save to `notification_preferences` table

**Migration**: Add columns `push_hedge_alerts boolean default true` and `email_hedge_summary boolean default false` to `notification_preferences`

### 2. Create `send-hedge-push-notification` edge function
**File**: `supabase/functions/send-hedge-push-notification/index.ts`
- Called by `hedge-live-telegram-tracker` after it detects status changes
- Queries `push_subscriptions` joined with `notification_preferences` where `push_hedge_alerts = true`
- Sends browser push notifications with hedge status details (player, prop, status transition, action recommendation)
- Only sends for significant status changes: transitions to HEDGE ALERT, HEDGE NOW, or LOCK

### 3. Integrate into existing hedge tracker
**File**: `supabase/functions/hedge-live-telegram-tracker/index.ts`
- After sending Telegram updates (line 349-355), also invoke `send-hedge-push-notification` with the same status change data
- Pass player name, prop type, line, side, current value, projected final, hedge action, and status transition

### 4. Add hedge alert toggle to PushNotificationToggle
**File**: `src/components/odds/PushNotificationToggle.tsx`
- Add a "Hedge Alerts" switch alongside the existing "Sharp moves only" toggle
- When subscribing, include `hedgeAlerts: true` in subscription preferences

### 5. In-app notification feed (lightweight)
**Migration**: Create `customer_hedge_notifications` table (id, user_id, player_name, prop_type, line, side, hedge_action, message, read, created_at)
- The `send-hedge-push-notification` function also inserts into this table
- Surface unread count via a bell icon badge in the app header

### Files to Change
| File | Change |
|------|--------|
| `notification_preferences` table | Add `push_hedge_alerts`, `email_hedge_summary` columns |
| New `customer_hedge_notifications` table | Store in-app hedge alerts per user |
| `supabase/functions/send-hedge-push-notification/index.ts` | New function: push + in-app hedge alerts |
| `supabase/functions/hedge-live-telegram-tracker/index.ts` | Invoke push notification function after status changes |
| `src/components/profile/NotificationPreferences.tsx` | Add hedge alert toggles |
| `src/components/odds/PushNotificationToggle.tsx` | Add hedge alerts option |

