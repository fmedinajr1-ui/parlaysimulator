

# Pre-Generation Game Schedule Validation

## Problem
Parlays are being voided because they include players who don't have games scheduled. The current availability gate checks `unified_props` for active lines, but this data can be stale or incomplete. Adding an explicit game schedule cross-reference will catch any remaining gaps.

## Solution
Add a **team-level game schedule check** as a new layer in the availability gate inside `bot-generate-daily-parlays`. Before building the prop pool, fetch today's scheduled games from `upcoming_games_cache` (and optionally `game_bets`) to build a set of teams playing today. Then reject any player pick whose team is not in that set.

## Changes

### 1. New function: `fetchTeamsPlayingToday`
Query `upcoming_games_cache` and `game_bets` for today's date window to build a `Set<string>` of all team names with confirmed games. This is more reliable than player-level checks because game schedules are set days in advance.

### 2. Build team-to-player mapping
Use the `team_name` field already present on `category_sweet_spots` picks to cross-reference. If `team_name` is missing, fall back to the existing `unified_props` active-player check.

### 3. Apply game schedule filter in `buildPropPool`
After the existing availability gate (lines 1125-1176), add a second pass that rejects any pick where the player's team is not in `teamsPlayingToday`. Log removed picks for diagnostics.

### 4. Logging
Add clear log lines showing:
- How many teams have games today
- How many picks were removed due to "team not playing today"
- Which players/teams were filtered out

## Technical Details

### File Modified
- `supabase/functions/bot-generate-daily-parlays/index.ts`

### New function (added near line 845)

```typescript
async function fetchTeamsPlayingToday(
  supabase: any,
  startUtc: string,
  endUtc: string,
  gameDate: string
): Promise<Set<string>> {
  const teams = new Set<string>();

  // Source 1: upcoming_games_cache (most reliable for schedule)
  const { data: upcoming } = await supabase
    .from('upcoming_games_cache')
    .select('home_team, away_team')
    .gte('commence_time', startUtc)
    .lt('commence_time', endUtc);

  (upcoming || []).forEach((g: any) => {
    if (g.home_team) teams.add(g.home_team.toLowerCase().trim());
    if (g.away_team) teams.add(g.away_team.toLowerCase().trim());
  });

  // Source 2: game_bets (backup, already fetched for team props)
  const { data: bets } = await supabase
    .from('game_bets')
    .select('home_team, away_team')
    .eq('is_active', true)
    .gte('commence_time', startUtc)
    .lt('commence_time', endUtc);

  (bets || []).forEach((g: any) => {
    if (g.home_team) teams.add(g.home_team.toLowerCase().trim());
    if (g.away_team) teams.add(g.away_team.toLowerCase().trim());
  });

  console.log(`[GameSchedule] ${teams.size} teams playing today`);
  return teams;
}
```

### Filter applied after existing availability gate (around line 1176)

```typescript
// === GAME SCHEDULE GATE ===
if (teamsPlayingToday.size > 0) {
  const preScheduleCount = enrichedSweetSpots.length;
  const removedBySchedule: string[] = [];

  enrichedSweetSpots = enrichedSweetSpots.filter(pick => {
    const teamName = (pick.team_name || '').toLowerCase().trim();
    if (!teamName) return true; // No team info, rely on other gates
    if (teamsPlayingToday.has(teamName)) return true;
    removedBySchedule.push(`${pick.player_name} (${pick.team_name})`);
    return false;
  });

  console.log(`[GameSchedule] Filtered: ${preScheduleCount} -> ${enrichedSweetSpots.length} (removed ${removedBySchedule.length} players on teams not playing)`);
  if (removedBySchedule.length > 0) {
    console.log(`[GameSchedule] Removed: ${removedBySchedule.slice(0, 15).join(', ')}`);
  }
}
```

### Integration point
The `fetchTeamsPlayingToday` call is added to the existing `Promise.all` block alongside `fetchActivePlayersToday` and `fetchInjuryBlocklist` so it runs in parallel with no added latency.

## Expected Impact
- Catches any pick where the player's team has no game today, even if `unified_props` data is stale
- Works alongside the existing real-line gate as a second safety net
- Zero additional latency (parallel fetch)
- Clear diagnostic logging to track effectiveness

