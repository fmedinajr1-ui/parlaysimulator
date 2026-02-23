
## Remove Bottom Navigation from Mobile

The bottom navigation bar (`BottomNav`) currently shows on mobile with Bot, Analysis tabs and a hamburger menu drawer. The user wants it removed entirely. The `MobileFloatingMenu` (floating hamburger button, top-right) already provides navigation access, so removing the bottom nav is safe.

### Changes

**File: `src/App.tsx`**
- Remove the `BottomNav` import (if present) or confirm it's not directly used here
- The `MobileFloatingMenu` component stays -- it's the floating hamburger button at top-right which is separate

**File: `src/components/layout/MobileLayout.tsx`**
- No changes needed -- it doesn't render `BottomNav`

After checking, `BottomNav` is not imported in `App.tsx`. Let me find where it's actually rendered.

### Investigation Needed
I need to find where `BottomNav` is actually mounted. Looking at the screenshot, the bottom bar with the hamburger icon is the `BottomNav` component which includes `MenuDrawer`. 

### Approach
1. Search for where `BottomNav` is imported and rendered
2. Remove that import and usage
3. The `MobileFloatingMenu` (already in `App.tsx` line 141) will continue serving as the navigation method

### Technical Details
- Remove `BottomNav` component usage from wherever it's rendered (need to locate this)
- Keep `MobileFloatingMenu` in `App.tsx` (line 141) as the sole mobile navigation
- Pages may need bottom padding adjustments since the fixed bottom bar (`h-[76px]`) will no longer exist
