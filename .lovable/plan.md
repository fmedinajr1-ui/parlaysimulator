
# Revive the Scout Page — Full Feature Restoration

## What's Currently Broken

The Scout page (`src/pages/Scout.tsx`) exists and is fully built, but it is **completely unreachable** because no route is registered for `/scout` in `App.tsx`. It also has no entry in the menu drawer or bottom nav.

All backend edge functions the Scout page depends on are deployed and operational:
- `analyze-game-footage` — Upload mode video AI analysis
- `analyze-live-frame` — Live mode per-frame AI detection
- `compile-halftime-analysis` — Halftime synthesis of all captured moments
- `scout-agent-loop` — Autopilot mode continuous AI loop
- `scout-data-projection` — Data-only projection engine (no video required)
- `fetch-live-pbp` — Play-by-play polling
- `sync-missing-rosters` — Jersey/roster sync from BDL + ESPN
- `bulk-sync-jerseys` — Bulk sync all 30 NBA teams
- `build-player-profile` — Film profile builder
- `refresh-todays-props` — Game list data source

The game selector reads from `unified_props` and `bdl_player_cache`, both populated. All Scout sub-components (`ScoutVideoUpload`, `ScoutLiveCapture`, `ScoutAutonomousAgent`, `FilmProfileUpload`, `ScoutAnalysisResults`, `ScoutGameSelector`) exist and import correctly.

---

## What Needs To Be Fixed

### 1. Register `/scout` Route in App.tsx
The Scout page is lazy-loaded elsewhere in the codebase but never added to `AnimatedRoutes`. This is the primary fix — add:
```tsx
const Scout = React.lazy(() => import("./pages/Scout"));
// ...
<Route path="/scout" element={<Scout />} />
```

### 2. Add Scout to the Menu Drawer
`src/components/layout/MenuDrawer.tsx` has a `menuItems` array with only Team Bets. Scout needs to be added so users can navigate to it from the hamburger menu. The quick action on the home page (`Index.tsx` line 70) already links to `/scout`, but the menu drawer is the persistent navigation point.

Add Scout to `menuItems`:
```typescript
{ icon: Eye, label: "Scout", path: "/scout", description: "AI video analysis for halftime edges" }
```

### 3. Add Scout to Bottom Nav (Optional — Assessed Below)
The bottom nav currently shows Bot, Analysis, and the menu drawer. The quick actions row on the homepage already surfaces Scout prominently. Scout is a niche live-game feature that doesn't warrant a permanent nav slot alongside the core picks flow. It will remain accessible via the home page quick actions and the menu drawer.

---

## Files to Change

| File | Change |
|---|---|
| `src/App.tsx` | Add `Scout` lazy import + `/scout` route |
| `src/components/layout/MenuDrawer.tsx` | Add Scout to `menuItems` array |

---

## Technical Notes

- The Scout page uses `AppShell` for layout, consistent with other pages — no new layout wrapper needed.
- All Scout edge functions are already deployed and confirmed working per the function list.
- The `analyze-game-footage` function requires `OPENAI_API_KEY` — already configured (it was working previously before the route was removed).
- The `ScoutGameSelector` component auto-refreshes props from `unified_props` with a 5-minute cache (`scout_props_last_refresh` in localStorage) and triggers `refresh-todays-props` if no games are found — this path is fully functional.
- The Autopilot mode's data-only projection runs every 15 seconds even without video — users without a capture card can still get live data projections.

---

## Implementation Steps

1. Add `const Scout = React.lazy(() => import("./pages/Scout"));` to the lazy imports block in `App.tsx`
2. Add `<Route path="/scout" element={<Scout />} />` inside `AnimatedRoutes` in `App.tsx`
3. Add `Eye` icon import and Scout entry to `menuItems` in `MenuDrawer.tsx`

These are the only two files that need changes. The Scout page and all its components are already complete and functional.
