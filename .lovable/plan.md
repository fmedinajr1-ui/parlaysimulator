

## Admin War Room Page

### Goal
Add a new "Scout War Room" section to the Admin panel that renders the full customer Scout/War Room dashboard directly, so you can view it without navigating to `/scout` or needing a link.

### What Changes

**1. Add "Scout War Room" to Admin section config**

In `src/pages/Admin.tsx`, add a new section entry to `sectionConfig` and the `AdminSection` type:
- ID: `'scout-warroom'`
- Title: "Scout War Room"  
- Description: "Live customer War Room dashboard view"
- Icon: `Eye` (already imported)
- Color: `text-emerald-500`

**2. Add the section render case**

In the `renderSectionContent()` switch statement, add a `case 'scout-warroom'` that:
- Imports and renders `CustomerScoutView` wrapped in `RiskModeProvider`
- Uses the same game resolution logic from `Scout.tsx` (fetch `scout_active_game`, resolve ESPN ID, build `ScoutGameContext`)
- Falls back to `demoGameContext` when no game is live
- Includes the game strip so you can switch between games just like customers see it

**3. New wrapper component: `src/components/admin/AdminWarRoomView.tsx`**

A self-contained component that:
- Fetches `scout_active_game` from the database
- Resolves the ESPN event ID via the `get-espn-event-id` edge function
- Builds a `ScoutGameContext` and passes it to `CustomerScoutView`
- Shows demo mode if no game is live
- Wraps everything in `RiskModeProvider`

This keeps the Admin page clean (just renders `<AdminWarRoomView />`) and encapsulates all the game resolution logic.

### Technical Details

**Files modified:**
- `src/pages/Admin.tsx` -- add `'scout-warroom'` to `AdminSection` type, add config entry, add render case

**Files created:**
- `src/components/admin/AdminWarRoomView.tsx` -- standalone component that handles game fetching + renders `CustomerScoutView`

**Imports needed in AdminWarRoomView:**
- `CustomerScoutView` from `@/components/scout/CustomerScoutView`
- `RiskModeProvider` from `@/contexts/RiskModeContext`
- `demoGameContext` from `@/data/demoScoutData`
- `supabase` from `@/integrations/supabase/client`
- `useQuery` from `@tanstack/react-query`
- `ScoutGameContext` type from `@/pages/Scout`

**No database changes required.** The admin already has access to `scout_active_game` and all War Room data sources.

### Result
You'll see "Scout War Room" as a card in the Admin Panel overview. Clicking it loads the full customer War Room dashboard inline -- same prop cards, hedge alerts, game strip, and all intelligence engine features -- without leaving the admin interface.

