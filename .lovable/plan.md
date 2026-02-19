

## Customer Scout View: Stream + Sweet Spots Props + Hedge Recommendations

### Goal
Rebuild the customer-facing Scout page to show three core sections: the live stream, player props pulled from the Sweet Spots data (category_sweet_spots), and hedge recommendations -- all for the selected game.

### Changes

#### 1. Create `CustomerScoutView` component
**New file:** `src/components/scout/CustomerScoutView.tsx`

A dedicated component for customers that replaces the current autopilot agent view. It contains:

- **Stream Panel**: Embed or placeholder for the game stream (video element for future multi-game streaming work)
- **Sweet Spot Props Panel**: Fetches today's picks from `category_sweet_spots` filtered by the selected game's teams/players, showing player name, prop type, line, side, L10 hit rate, projected value, and edge
- **Hedge Recommendations Panel**: Uses the existing `useSweetSpotLiveData` hook to enrich sweet spots with real-time data, then renders the existing `HedgeRecommendation` component for each live spot that has hedge status

#### 2. Update `Scout.tsx` to render `CustomerScoutView` for customers
**File:** `src/pages/Scout.tsx`

- When `isCustomer` is true and a game is selected, render `CustomerScoutView` instead of `ScoutAutonomousAgent`
- Pass the selected game context so props can be filtered by teams in that game

#### 3. Create `ScoutSweetSpotProps` sub-component
**New file:** `src/components/scout/ScoutSweetSpotProps.tsx`

Displays sweet spot picks relevant to the selected game:
- Query `category_sweet_spots` for today's date, filtered by players on the two teams
- Show each pick as a card with: player name, prop type badge, line, side (OVER/UNDER), L10 hit rate, projected value, and projection edge
- Color-code by hit rate tier (90%+ elite green, 75%+ strong emerald)
- Uses the same styling patterns as `SweetSpotPicksCard`

#### 4. Create `ScoutHedgePanel` sub-component
**New file:** `src/components/scout/ScoutHedgePanel.tsx`

Displays live hedge recommendations for in-progress spots:
- Uses `useSweetSpotLiveData` to get enriched spots with live data
- Filters to spots matching the selected game's teams
- Renders the existing `HedgeRecommendation` component for each spot that has live hedge status
- Shows status badges (ON TRACK, MONITOR, ALERT, URGENT, PROFIT LOCK)
- Falls back to "No live hedge data yet" when game hasn't started

### Layout

```text
+-----------------------------------------------+
|  Game Selector (existing)                      |
+-----------------------------------------------+
|                                                |
|  Stream Panel (video embed / placeholder)      |
|                                                |
+------------------------+-----------------------+
|                        |                       |
|  Sweet Spot Props      |  Hedge Recommendations|
|  (from category data)  |  (live hedge status)  |
|                        |                       |
+------------------------+-----------------------+
```

### Technical Details

| Item | Detail |
|------|--------|
| Data source for props | `category_sweet_spots` table, filtered by today + game teams |
| Data source for hedges | `useSweetSpotLiveData` hook enriching `deep_sweet_spots` with live feed |
| Hedge component | Reuses existing `HedgeRecommendation` from `src/components/sweetspots/` |
| Hedge status calc | Reuses `calculateHedgeStatus` from `src/lib/hedgeStatusUtils.ts` |
| Filtering | Props/hedges filtered to players on the two teams in the selected game |
| Customer gating | `isCustomer` check in `Scout.tsx` routes to `CustomerScoutView` |
| Admin view | Unchanged -- full autopilot agent with all controls |

