

# Reconfigure Parlay Farm: Bot + Sweet Spots Only

## Overview

Strip the site down to two core pages -- **Bot Dashboard** (homepage) and **Player Analysis / Sweet Spots** -- removing all other pages, navigation clutter, and unused components. The UI will be tightened and polished for a focused, premium experience.

## What Changes

### 1. Make Bot Dashboard the Homepage
- Route `/` renders `BotDashboard` instead of the old `Index` page
- Keep `/sweet-spots` as the second page
- Redirect all removed routes to `/`
- Wrap `BotDashboard` in `AppShell` for consistent layout

### 2. Strip Routes (App.tsx)
Remove all routes except:
- `/` -- Bot Dashboard (new homepage)
- `/sweet-spots` -- Player Analysis
- `/auth` -- Redirect to `/`
- `/verify-email` -- Keep for auth flow
- `/admin` -- Keep for admin access
- `/admin/releases` -- Keep for admin
- `/collaborate` -- Keep for admin
- `/offline` -- PWA offline fallback
- `*` -- NotFound (redirects to `/`)

All other routes (`/upload`, `/compare`, `/pools`, `/profile`, `/bot`, `/best-bets`, `/live-dashboard`, `/scout`, etc.) will be removed or redirected to `/`.

### 3. Simplify Navigation

**Desktop Sidebar** -- Only 2 main nav items:
- Bot (Home icon, `/`)
- Player Analysis (Target icon, `/sweet-spots`)
- Admin section stays for admin users

**Mobile Bottom Nav** -- Only 2 tabs + Menu:
- Bot (Home icon, `/`)
- Analysis (Target icon, `/sweet-spots`)
- More menu (admin tools only)

**Menu Drawer** -- Remove "Tools" section (Manual Builder, Tomorrow 3PT, Tomorrow Assists). Keep admin section only.

### 4. Enhance Bot Dashboard UI
- Wrap in `AppShell` for consistent sidebar/mobile layout
- Remove the `min-h-screen bg-background p-4 pb-32` wrapper (AppShell handles it)
- Make the sticky bottom action bar (Generate/Settle) work within AppShell's padding
- Add a quick-link card/button to navigate to Sweet Spots from the Bot page

### 5. Enhance Sweet Spots Page
- Remove the back arrow button (no longer needed, sidebar handles nav)
- Wrap in `AppShell` for consistent layout
- Keep the sticky header with tabs (Scanner, Sweet Spots, Fades)

### 6. Remove Unused Lazy Imports
Remove ~30 lazy import declarations from App.tsx for pages that no longer have routes. The page files themselves stay in the repo (no deletion) but won't be loaded.

### 7. Remove HeroBanner and Index Page References
- The old Index page with HeroBanner, DailyParlayHub, Quick Actions, etc. is replaced entirely
- Remove `HeroBanner`, `HowItWorks`, `SampleParlayButton` from the active code path

## Technical Details

### App.tsx Changes
```text
Routes reduced from ~45 to ~8:
  / --> BotDashboard
  /sweet-spots --> SweetSpots
  /auth --> Navigate to /
  /verify-email --> VerifyEmail
  /admin --> Admin
  /admin/releases --> ReleaseManager  
  /collaborate --> Collaborate
  /offline --> Offline
  * --> NotFound
```

### DesktopSidebar.tsx
```text
mainNavItems = [
  { icon: Home, label: "Bot", path: "/" },
  { icon: Target, label: "Analysis", path: "/sweet-spots" },
]
```

### BottomNav.tsx
```text
allNavItems = [
  { icon: Home, label: "Bot", path: "/" },
  { icon: Target, label: "Analysis", path: "/sweet-spots" },
]
```

### BotDashboard.tsx
- Wrap content in `<AppShell>` 
- Adjust padding/margins for AppShell compatibility
- Fix sticky bottom bar positioning for desktop layout

### SweetSpots.tsx
- Wrap in `<AppShell noPadding>`
- Remove back arrow button
- Keep sticky header behavior

### MenuDrawer.tsx
- Remove `toolItems` array
- Only show admin items when admin

## Files Modified
1. `src/App.tsx` -- Routes + lazy imports
2. `src/components/layout/DesktopSidebar.tsx` -- Nav items
3. `src/components/BottomNav.tsx` -- Nav items
4. `src/components/layout/MenuDrawer.tsx` -- Remove tools section
5. `src/pages/BotDashboard.tsx` -- AppShell wrapper + UI tweaks
6. `src/pages/SweetSpots.tsx` -- AppShell wrapper + remove back button

## No Files Deleted
All page files remain in the repo for reference. They just won't have routes pointing to them.

