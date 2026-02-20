

## Remove Sidebar + Bottom Nav on Mobile, Clean Up Mobile UI

### Overview
Strip the mobile experience down to a clean, full-screen, app-like feel -- no bottom tab bar, no sidebar drawer. Navigation moves inline into the landing page content itself (e.g., section links or contextual CTAs). Desktop sidebar stays untouched.

### Changes

**1. Remove BottomNav on mobile** 
- In `src/App.tsx`, remove the `{isMobile && <BottomNav />}` render entirely
- The BottomNav component stays in the codebase (desktop doesn't use it either, so it's effectively unused), or we can delete it outright

**2. Remove MenuDrawer from BottomNav**
- Since BottomNav is gone, the hamburger menu drawer is also gone from mobile
- Menu items (Team Bets, Scout) become accessible via inline links on the landing page or via a minimal top header menu

**3. Clean up MobileLayout padding**
- In `src/components/layout/MobileLayout.tsx`, remove the `pb-[88px]` bottom padding (no more bottom nav to account for)
- Make it edge-to-edge: reduce default horizontal padding for a more immersive feel

**4. Modernize BotLanding.tsx for mobile**
- Remove the top `<nav>` bar with the logo border -- replace with a floating logo or integrate into the hero
- Make the hero section full-bleed with larger typography and tighter spacing
- Add inline navigation links to Team Bets, Scout, Sweet Spots within the page content (e.g., a "Quick Links" row or contextual buttons)
- Remove `pb-24` (was for bottom nav clearance)

**5. Add lightweight mobile navigation**
- Add a minimal floating menu button (top-right corner) that opens a small popover or bottom sheet with page links (Sweet Spots, Team Bets, Scout, Dashboard)
- This replaces both the sidebar and bottom tab bar with a single, unobtrusive access point

**6. Update AppShell mobile detection**
- Ensure `AppShell` and `MobileLayout` don't add extra padding for bottom nav

### Technical Details

| File | Change |
|------|--------|
| `src/App.tsx` | Remove `{isMobile && <BottomNav />}` line (~line 131) |
| `src/components/layout/MobileLayout.tsx` | Change `pb-[88px]` to `pb-4`, reduce px from 4 to 3 for tighter mobile feel |
| `src/pages/BotLanding.tsx` | Remove `pb-24`, redesign top nav to floating/minimal, add inline navigation row for other pages |
| `src/components/layout/MobileHeader.tsx` | Add optional floating menu trigger (small FAB-style button) |
| New: `src/components/layout/MobileFloatingMenu.tsx` | Lightweight floating action button that opens a drawer/popover with navigation links (replaces sidebar + bottom nav) |
| Various pages using `pb-24` or bottom-nav spacing | Remove bottom padding overrides (LiveDashboard, etc.) |

### What stays the same
- Desktop sidebar and layout -- completely untouched
- All routes and page components
- Sheet/Drawer UI primitives (reused for the new floating menu)

