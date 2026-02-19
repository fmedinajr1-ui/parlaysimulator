
## Add Live Game Indicator on Scout Admin Page

### What Changes
Show a banner on the admin Scout page indicating which game is currently set live for customers. This gives admins instant visibility without needing to check the database.

### Implementation

**File: `src/pages/Scout.tsx`**

1. **Fetch the active game for admins too** -- The existing `useQuery` for `scout-active-game` is currently only enabled for customers (`enabled: isCustomer`). Change it to also run for admins so we know what game is currently live.

2. **Add a "Currently Live" indicator** below the game selector (near the "Set Live for Customers" button). It will:
   - Show a green pulsing dot + the game description (e.g., "Atlanta Hawks @ Philadelphia 76ers") when a game is live
   - Show "No game currently live" in muted text when there's no active game
   - Include a subtle badge/banner style using existing emerald color scheme to match the "Set Live" button aesthetic
   - Auto-update when the admin sets a new game live by invalidating the query after `handleSetLive` succeeds

### Technical Details

- Update the `useQuery` `enabled` condition from `isCustomer` to `isCustomer || isAdmin` (or just `hasAccess`)
- After a successful `handleSetLive`, call `queryClient.invalidateQueries({ queryKey: ['scout-active-game'] })` to refresh the indicator
- Add a small UI block between the game selector and the mode tabs showing the live status, something like:

```text
+---------------------------------------------+
| [pulsing dot] LIVE: Hawks @ 76ers           |
+---------------------------------------------+
```

- Uses existing Badge and styling patterns -- no new components or dependencies needed
