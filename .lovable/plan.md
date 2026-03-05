

# Broadcast New Strategy Parlays to All Customers

## Current State
- 8 new parlays exist: 4 floor_lock, 3 optimal_combo, 1 ceiling_shot
- All have `approval_status: pending_approval`
- The existing `/broadcast` command only sends `approved`/`edited` parlays

## Plan

### 1. Approve all 8 new strategy parlays via SQL migration
Update the 8 parlays' `approval_status` from `pending_approval` to `approved`.

### 2. Add a new `new_strategies_broadcast` message type to `bot-send-telegram/index.ts`
- New formatter function `formatNewStrategiesBroadcast()` that creates a clean customer message grouped by strategy type:
  - **OPTIMAL COMBO** section (dice emoji) — shows combined L10 probability score
  - **FLOOR LOCK** section (lock emoji) — highlights the safety/consistency angle  
  - **CEILING SHOT** section (rocket emoji) — highlights upside potential
- Each parlay shows: strategy label, combined odds, then **all legs expanded** with player name, side, line, prop type, and L10 hit rate
- Add `new_strategies_broadcast` to the customer broadcast whitelist (line ~1616)

### 3. Create `broadcast-new-strategies` edge function
Simple function that:
1. Queries `bot_daily_parlays` for today's floor_lock, ceiling_shot, optimal_combo parlays
2. Approves any still pending
3. Formats the data and sends to `bot-send-telegram` with type `new_strategies_broadcast`
4. Broadcasts to all active customers

### 4. Invoke the function to trigger the broadcast

### Files Changed
1. **`supabase/functions/bot-send-telegram/index.ts`** — add `new_strategies_broadcast` type + formatter + customer broadcast whitelist
2. **`supabase/functions/broadcast-new-strategies/index.ts`** — new edge function to approve + broadcast

