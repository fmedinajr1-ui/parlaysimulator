

## Hide Admin Controls from Customer Scout View

### Goal
Customers should see a clean, read-only Scout dashboard with just the streaming data and analysis tabs -- no Start/Stop/Pause buttons, no settings gear, no capture mode toggles. The agent should auto-start in data-only mode for customers.

### Changes

#### 1. Pass `isCustomer` prop to `ScoutAutonomousAgent`
**File:** `src/pages/Scout.tsx`
- Pass `isCustomer={isCustomer}` to the `ScoutAutonomousAgent` component

#### 2. Update `ScoutAutonomousAgent` to hide admin controls for customers
**File:** `src/components/scout/ScoutAutonomousAgent.tsx`
- Accept `isCustomer` prop
- When `isCustomer` is true:
  - Hide the "Start Autopilot" / Stop / Pause buttons
  - Hide the Settings gear icon
  - Hide the settings panel (capture mode, device selector, FPS slider, data-only toggle)
  - Auto-start the agent in **data-only mode** on mount (no video capture required)
  - Show a simplified header: just "Scout Autopilot" with the status/stats timestamp, and the Refresh Stats button
- When `isCustomer` is false (admin): no changes, everything works as before

#### 3. Auto-start behavior for customers
- On component mount, if `isCustomer` is true and agent is not running, automatically call `startAgent()` with data-only mode enabled
- This means customers see the tabs (Game Bets, Player Props, Lock Mode, Advanced) populated with live data immediately after selecting a game
- No screen share or camera prompts

### Technical Details

| Item | Detail |
|------|--------|
| Hidden elements (customer) | Start/Stop/Pause buttons, Settings gear, Settings panel (capture mode, device selector, FPS, data-only toggle) |
| Visible elements (customer) | Bot icon, "Scout Autopilot" title, stats timestamp, Refresh button, all 4 analysis tabs |
| Auto-start | Data-only mode triggers automatically on mount for customers |
| Admin view | Unchanged -- full control panel remains |

