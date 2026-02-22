

## Add War Room Tab to the Dashboard

### What Changes

The BotDashboard (`/dashboard`) currently has 5 tabs: Overview, Parlays, Analytics, Research, Simulation. This adds a 6th **"War Room"** tab that renders the full Scout War Room inline -- same prop cards, hedge alerts, game strip, and intelligence engine -- without leaving the dashboard.

### Implementation

**File modified: `src/pages/BotDashboard.tsx`**

1. Import `AdminWarRoomView` (the component we already built for the Admin panel -- it handles fetching `scout_active_game`, resolving ESPN IDs, and rendering `CustomerScoutView` inside `RiskModeProvider`).

2. Add a new tab trigger to the `TabsList`:
   - Label: "War Room"
   - Icon: `Eye` (consistent with Scout branding)
   - Placed after the existing 5 tabs

3. Add a new `TabsContent` for `value="warroom"` that renders `<AdminWarRoomView />`.

4. Update the `TabsList` grid from `grid-cols-5` (implicit) to accommodate 6 tabs -- or switch to a scrollable flex layout since 6 tabs is tight on mobile.

### Technical Details

- **1 file modified**: `src/pages/BotDashboard.tsx`
- **0 files created**: Reuses `AdminWarRoomView` from `src/components/admin/AdminWarRoomView.tsx`
- No database changes
- The `AdminWarRoomView` already handles all game fetching, ESPN ID resolution, demo mode fallback, and game switching via the game strip

### Result

Opening `/dashboard` and clicking the "War Room" tab loads the full live War Room dashboard inline with all prop intelligence cards, pace meters, edge scores, hedge alerts, and Monte Carlo toggle.

