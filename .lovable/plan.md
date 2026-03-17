

# Slate Strength Advisory — Notify Admin + Customers

## What It Does
After the game context analyzer runs each morning, send a **Slate Advisory** notification to:
1. **Admin (Telegram)** — full breakdown of game count, sports, flags, recommended stake multiplier
2. **Customers (Push + In-app)** — simplified message like "🟡 Light Slate Day — 4 games. We recommend reducing stakes by 50%" or "🟢 Heavy Slate — 12 games across NBA/NHL. Full volume today!"

## Slate Classification Logic
| Games | Classification | Stake Guidance |
|-------|---------------|----------------|
| < 6 | 🔴 Thin Slate | Reduce stakes 50%, max 3 legs |
| 6–8 | 🟡 Light Slate | Reduce stakes 25% |
| 9+ | 🟢 Heavy Slate | Full volume |

## Changes

### 1. Add `push_slate_advisory` to notification preferences
**Migration**: Add `push_slate_advisory boolean default true` to `notification_preferences` table so customers can opt in/out.

### 2. Create `send-slate-advisory` edge function
New function that:
- Accepts slate data (game count, sports, flags, classification, stake guidance)
- Sends admin Telegram message via `bot-send-telegram` with full details
- Sends customer push notifications (via existing `push_subscriptions` + `notification_preferences` where `push_slate_advisory = true`)
- Inserts into `customer_hedge_notifications` table (reuse as a general notification feed) with a `slate_advisory` type

### 3. Integrate into `bot-game-context-analyzer`
After the context analysis completes (line ~185), invoke `send-slate-advisory` with the classification data. This runs daily before generation, so customers get the advisory before picks drop.

### 4. Add toggle in NotificationPreferences UI
Add a "Slate Day Advisory" push toggle in the Notification Preferences panel alongside the existing hedge and release toggles.

### Files to Change
| File | Change |
|------|--------|
| Migration | Add `push_slate_advisory` column to `notification_preferences` |
| `supabase/functions/send-slate-advisory/index.ts` | New: classify slate, push to admin + customers |
| `supabase/functions/bot-game-context-analyzer/index.ts` | Invoke `send-slate-advisory` after analysis |
| `src/components/profile/NotificationPreferences.tsx` | Add slate advisory toggle |

