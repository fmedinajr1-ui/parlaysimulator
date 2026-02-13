

# Fix: Add Team Bets Route and Navigation

## Problem

The Team Bets page (`src/pages/TeamBets.tsx`) exists and the backend data is fully populated (composite scores up to 91, with reasoning breakdowns), but:

1. **No route registered** in `App.tsx` -- navigating to `/team-bets` gives a 404
2. **No navigation link** in `BottomNav` or `MenuDrawer` -- users can't discover the page

## Verified Data

The `game_bets` table has NCAAB picks with rich composite scores and breakdowns:
- Totals scoring 91 with "Combined tempo: 72.5 (fast)"
- Moneylines scoring 85.6 with "+12.0 pts edge", "Rank #6 vs #130"
- All fields populated: `composite_score`, `score_breakdown`, `recommended_side`

## Changes

### 1. Add `/team-bets` route to `App.tsx`
- Add lazy import for `TeamBets` page
- Add `<Route path="/team-bets" ...>` alongside existing routes

### 2. Add Team Bets to navigation
- Add a "Team Bets" item to the `MenuDrawer` with a Target icon so users can find it from the hamburger menu

### 3. Verify the page renders
- Navigate to `/team-bets` after the fix to confirm NCAAB picks display with composite scores and reasoning pills

## Technical Details

### `src/App.tsx`
- Line 30: Add `const TeamBets = React.lazy(() => import("./pages/TeamBets"));`
- Line 76 (before the catch-all route): Add `<Route path="/team-bets" element={<TeamBets />} />`

### `src/components/layout/MenuDrawer.tsx`
- Add `{ icon: Target, label: "Team Bets", path: "/team-bets", description: "NCAAB spreads, totals & ML" }` to the menu items array

