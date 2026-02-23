

## Remove Mobile Navigation from Homepage

The homepage/landing page should be a clean, distraction-free page strictly for customers to view stats and purchase subscriptions. No sidebar, floating menu, or navigation should appear.

### Changes

**File: `src/App.tsx`**
- Update the `MobileFloatingMenu` rendering to exclude the homepage route (`/`)
- Change `{isMobile && <MobileFloatingMenu />}` to conditionally hide it when on the `/` path using `useLocation`

The single-line change:
```tsx
{isMobile && location.pathname !== '/' && <MobileFloatingMenu />}
```

This ensures the floating hamburger menu (shown in the screenshot) does not appear on the landing page, while still being available on all other pages like `/dashboard`, `/team-bets`, `/scout`, etc.
