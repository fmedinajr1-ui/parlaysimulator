
# Fix "Unknown" Display for Team Legs -- Robust Fallback

## Root Cause

The current code at line 175 checks `leg.type === 'team'` to decide between team and player rendering. The database data is correct -- all team legs have `type: 'team'` set. However, the rendering still shows "Unknown" because the component falls through to the player path.

The fix needs to be more defensive: instead of relying solely on `leg.type === 'team'`, also detect team legs by checking for team-specific categories or the presence of `home_team`/`away_team` fields. This handles edge cases and makes the UI resilient.

## Changes

### File: `src/components/bot/BotParlayCard.tsx`

1. Add a helper function `isTeamLeg(leg)` that returns true if ANY of:
   - `leg.type === 'team'`
   - `leg.category` is one of: `SHARP_SPREAD`, `UNDER_TOTAL`, `OVER_TOTAL`, `ML_UNDERDOG`, `ML_FAVORITE`
   - `leg.home_team` and `leg.away_team` are both present

2. Replace all `leg.type === 'team'` checks with `isTeamLeg(leg)`

3. Use fallbacks for team name display:
   - Name: Use `home_team vs away_team` for totals, or the specific side's team for spreads/ML
   - Detail: Show bet type and line properly
   - If `home_team`/`away_team` are missing even on a team leg, show the category as the name instead of "Unknown"

This is a small, focused UI fix in one file.
