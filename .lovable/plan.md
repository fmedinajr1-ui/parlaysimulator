

## Fix: Customer View Not Showing Live Game Command Center

### Root Cause (Two Issues)

**Issue 1 — Published site is outdated**: The screenshot shows "Stream coming soon" text, which no longer exists in the current code. The published site at `parlaysimulator.lovable.app` hasn't been updated with the new `CustomerLiveGamePanel` component. The changes need to be published.

**Issue 2 — Missing ESPN Event ID for customers**: When the customer view auto-selects the active game (from `scout_active_game` table), it only passes the Odds API `event_id` (e.g., `d647541d42648749f3bde601547fa1be`). It does NOT resolve or pass the `espnEventId`. The `live_game_scores` table stores ESPN event IDs (e.g., `401810649`), so the lookup by event ID fails. While there is a team-name fallback, the customer path should also resolve the ESPN ID for reliability.

### Fix

**File: `src/pages/Scout.tsx` (lines 226-239)**

When auto-setting the selected game for customers, also call the `get-espn-event-id` edge function to resolve the ESPN event ID. This ensures the `CustomerLiveGamePanel` can look up the correct game in `live_game_scores`.

Steps:
1. Change the `useEffect` that auto-sets `selectedGame` for customers to also invoke `get-espn-event-id` with the home/away teams
2. Set `espnEventId` on the game context once resolved
3. This mirrors what `ScoutGameSelector` already does for the admin path

**Publish**: After the code fix, the app needs to be published so the customer URL reflects the changes.

### Technical Details

| File | Change |
|------|--------|
| `src/pages/Scout.tsx` | Resolve `espnEventId` in the customer auto-select `useEffect` via the `get-espn-event-id` edge function |

The team-name fallback in `CustomerLiveGamePanel` already works as a safety net, but having the proper ESPN ID makes the data lookup faster and more reliable.
