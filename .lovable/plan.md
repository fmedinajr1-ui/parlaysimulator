

# Fix Sweet Spot Pipeline: Only Filter by Today's Games + Injuries

## Problem
Three gates are crushing the sweet spot pool from ~500 down to ~17:

1. **AvailabilityGate (line 4545-4570)**: Requires player to exist in `unified_props` with active sportsbook lines today. This is the #1 killer -- only ~23 of 500 sweet spot players have active lines in `unified_props`. But the sweet spot engine already knows who's playing today.

2. **`canUsePickGlobally` 70% hit-rate gate (line 3036-3039)**: Hard-coded `if (hitRatePercent < 70) return false`. This blocks sweet spot picks that the engine already vetted. The engine's own confidence is the quality gate.

3. **GameSchedule gate (line 4594-4613)**: Filters by `teamsPlayingToday` set -- this one is actually fine and should stay, since it checks if the team is actually playing today.

## What Should Stay (per your direction)
- **Game schedule gate** (line 4594): Keep -- confirms team is playing today
- **Injury blocklist** (line 4556): Keep -- blocks OUT/DOUBTFUL players
- **GTD/Questionable penalty** (line 4562): Keep -- reduces confidence but doesn't hard-block

## What Gets Removed/Changed

### Change 1: Replace `activePlayersToday` gate with team-based check for sweet spots
**Lines 4545-4570**

Currently: If player is NOT in `unified_props` active lines, hard-block them.
New behavior: For sweet spots, only check:
- Is their team playing today? (use `teamsPlayingToday` set)
- Are they on the injury blocklist (OUT/DOUBTFUL)?

Remove the `activePlayersToday.has(normalizedName)` check entirely for sweet spot picks. The game schedule gate at line 4594 already validates the team is playing.

### Change 2: Bypass the 70% hit-rate gate in `canUsePickGlobally` for sweet spot profiles
**Lines 3036-3039**

Currently: Hard `if (hitRatePercent < 70) return false` for ALL picks.
New behavior: Accept a `profileType` parameter. For `sweet_spot_core` and `sweet_spot_plus` profiles, skip this gate entirely (the engine already pre-vetted quality). For other profiles, keep the 70% gate.

Update the call site at line 6612 to pass profile type info.

### Change 3: Lower `sweet_spot_core` profile `minHitRate` to 55%
**Lines 879-898 (profile definitions)**

Change all `sweet_spot_core` entries from `minHitRate: 65/70/75` to `minHitRate: 55`. The engine's own L10 hit rates are the real quality signal.

## Expected Result
- Pool goes from ~17 to ~300+ sweet spot picks (all players on teams playing today, minus injuries)
- `canUsePickGlobally` stops redundantly blocking engine-vetted picks
- The parlay builder works with the full pool, sorted by confidence, and smart-stacks by environment cluster
- Volume target: 30-40 unique parlays from the expanded pool

## File Modified
- `supabase/functions/bot-generate-daily-parlays/index.ts`

## Sections touched
- Lines 3014-3055: `canUsePickGlobally` -- add profile-aware bypass for 70% gate
- Lines 4545-4587: AvailabilityGate -- remove `activePlayersToday` requirement, keep only injury + team schedule
- Lines 879-898: Sweet spot profile definitions -- lower `minHitRate` to 55
- Line 6612: Call site for `canUsePickGlobally` -- pass profile context

