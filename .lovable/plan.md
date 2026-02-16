

# Auto-Refreshing Shadow Picks & Accuracy Data

## What Changes

Make the Simulation tab components continuously update with fresh data, so you always see the latest shadow picks and accuracy stats without manual refreshing.

### 1. ShadowPicksFeed: Real-Time Updates

- Enable Supabase realtime on the `simulation_shadow_picks` table so new picks appear instantly as the pipeline generates them
- Subscribe to `INSERT` events on the table -- when the simulation engine creates new shadow picks, they show up in the feed immediately
- Also subscribe to `UPDATE` events so when picks get settled (outcome changes from "pending" to "won"/"lost"), the badge updates live
- Add a small "Live" indicator dot (like the one on the Engine Activity Feed) to show the connection is active
- Auto-refresh the full list every 60 seconds as a fallback

### 2. SimulationAccuracyCard: Periodic Refresh

- Add a 60-second polling interval to re-fetch accuracy stats so the numbers update as picks get settled
- Show a subtle refresh indicator

### 3. Database: Enable Realtime

- Run a migration to add `simulation_shadow_picks` to the Supabase realtime publication so the subscription works

## Technical Details

### Database Migration
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.simulation_shadow_picks;
```

### ShadowPicksFeed Changes
- Add a Supabase realtime channel subscription for `postgres_changes` on `simulation_shadow_picks`
- On `INSERT`: prepend new pick to the list (cap at 50)
- On `UPDATE`: replace the updated pick in-place (for outcome changes)
- Add `isConnected` state and a live indicator in the header
- Add `setInterval` fallback polling every 60 seconds
- Clean up channel on unmount

### SimulationAccuracyCard Changes
- Wrap the fetch in a `setInterval` of 60 seconds
- Clean up on unmount

### Files Modified
- `src/components/bot/ShadowPicksFeed.tsx` -- add realtime subscription + live indicator
- `src/components/bot/SimulationAccuracyCard.tsx` -- add polling interval
- Database migration -- enable realtime on `simulation_shadow_picks`
