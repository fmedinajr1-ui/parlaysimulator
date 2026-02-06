
# Filter Fades Tab to Only Show Players with Games Today

## Problem

The "Risky Fades" section is displaying players who don't have games scheduled for today. Players like Isaiah Collier, Jamal Murray, James Harden, and Jusuf Nurkic appear in the list even though they're not playing.

**Data breakdown:**
- 14 players from fade categories have games today
- 40+ players don't have games but still show up

## Root Cause

The `useContrarianParlayBuilder.ts` hook:
1. Fetches all picks from `category_sweet_spots` for today's analysis date
2. Tries to look up live lines from `unified_props`
3. But **includes players even when no live game data is found**

## Solution

Filter the contrarian picks to only include players who have a verified game today (exist in `unified_props` with a valid `commence_time`).

## Technical Changes

### File: `src/hooks/useContrarianParlayBuilder.ts`

**Current behavior:**
```text
for (const spot of sweetSpots) {
  // ... processes all spots regardless of whether player has a game
  contrarianPicks.push({ ... });
}
```

**New behavior:**
```text
for (const spot of sweetSpots) {
  // Look up live line data
  const propKey = `${spot.player_name.toLowerCase()}-${spot.prop_type?.toLowerCase()}`;
  const liveData = lineMap.get(propKey);
  
  // SKIP players who don't have games today
  if (!liveData) continue;
  
  // ... rest of processing
  contrarianPicks.push({ ... });
}
```

The key change is adding a single line that skips players without matching entries in `unified_props`.

## Expected Outcome

| Before | After |
|--------|-------|
| 50+ fade picks shown (many without games) | ~14 fade picks (only players with games) |
| Isaiah Collier, Jamal Murray, etc. visible | Only Andrew Nembhard, Cade Cunningham, Jalen Brunson, etc. |
| Confusing for users | Clean, actionable picks only |

## Players Who Will Show After Fix

Based on today's games:
- **HIGH_ASSIST**: Andrew Nembhard, Cade Cunningham, Jalen Brunson, Mikal Bridges, Derrick White, Davion Mitchell, Donte DiVincenzo, Kevin Porter Jr., Ryan Rollins, Cam Spencer, Kawhi Leonard
- **ELITE_REB_OVER**: Rudy Gobert
- **MID_SCORER_UNDER**: Andrew Wiggins, John Collins
