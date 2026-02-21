

## Remove Slip Scanner and Sidebar

Two removals:

### 1. Remove Slip Scanner

**File:** `src/components/scout/warroom/WarRoomLayout.tsx`
- Remove the `import { CustomerSlipScanner }` line
- Remove the `<CustomerSlipScanner />` component from the JSX

**File:** `src/components/scout/CustomerSlipScanner.tsx`
- Delete the entire file (no longer needed)

### 2. Remove Desktop Sidebar

The sidebar is rendered via `AppShell` -> `DesktopLayout` -> `DesktopSidebar`. The simplest approach is to make `DesktopLayout` render children directly without the sidebar, keeping `AppShell` intact for the mobile/desktop detection logic.

**File:** `src/components/layout/DesktopLayout.tsx`
- Remove the `DesktopSidebar` import and all sidebar toggle state/logic
- Render just the `<main>` content directly (full width, no sidebar)

**File:** `src/components/layout/DesktopSidebar.tsx`
- Delete the entire file (no longer used)

### Technical Details

- `DesktopLayout` will simplify to a wrapper that renders `children` in a full-width `<main>` with optional padding
- No other files import `DesktopSidebar` or `CustomerSlipScanner` directly, so no cascading changes needed
- The keyboard shortcut (Cmd+B) and localStorage sidebar state will be removed along with the sidebar

