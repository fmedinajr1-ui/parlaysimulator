

# Root Cause: Stale `upcoming_games_cache` Breaks Team Schedule Gate

## What's Happening

The `GameSchedule` filter in `bot-generate-daily-parlays` checks which teams are playing today using two sources:
1. **`upcoming_games_cache`** — last updated **January 9th** (completely stale, 0 NBA games)
2. **`game_bets`** — only contains **NHL games** (5 hockey teams)

Since these sources return ~10 NHL team names but zero NBA teams, the filter sees `teamsPlayingToday.size > 0` (truthy) and proceeds to remove every NBA player whose team isn't in the set. Result: **229 → 62 picks** (167 removed), even though there are 8 NBA games and 118 active players in `unified_props`.

This is why the pool has been "thin" — it's not the downstream filters. The schedule gate is deleting most of the pool before any other filter runs.

## Fix

### Change 1: Add `unified_props` as Source 3 in `fetchTeamsPlayingToday`

In `supabase/functions/bot-generate-daily-parlays/index.ts` (~line 3656), after the `game_bets` source, add a third source that extracts team names from `unified_props` player names cross-referenced with `bdl_player_cache`:

```typescript
// Source 3: Derive teams from unified_props active players + bdl_player_cache
const { data: activeProps } = await supabase
  .from('unified_props')
  .select('player_name')
  .eq('is_active', true)
  .gte('commence_time', startUtc)
  .lt('commence_time', endUtc);

if (activeProps && activeProps.length > 0) {
  const playerNames = [...new Set(activeProps.map(p => p.player_name).filter(Boolean))];
  const { data: playerTeams } = await supabase
    .from('bdl_player_cache')
    .select('player_name, team_name')
    .in('player_name', playerNames);
  
  (playerTeams || []).forEach(p => {
    if (p.team_name) teams.add(p.team_name.toLowerCase().trim());
  });
  console.log(`[GameSchedule] Added ${teams.size} teams from unified_props cross-ref`);
}
```

This ensures that even when `upcoming_games_cache` is stale (which it has been for 2+ months), the system still correctly identifies which NBA teams are playing by looking at who has active prop lines.

### Change 2: Also fix `upcoming_games_cache` staleness

Add `upcoming_games_cache` refresh to the `refresh-l10-and-rebuild` pipeline by invoking `game-news-aggregator` (which populates this cache) as an early step. This is a one-line addition to the rebuild steps array in `supabase/functions/refresh-l10-and-rebuild/index.ts`.

### Expected Impact
- **Pool size**: 62 → ~229 (the full post-injury-filter count)
- **Today's 8 games**: All NBA teams correctly detected
- **No risk**: This only adds teams, never removes — existing NHL/MLB team detection unaffected

### Files to Edit
- `supabase/functions/bot-generate-daily-parlays/index.ts` — add Source 3 to `fetchTeamsPlayingToday` (~line 3656)
- `supabase/functions/refresh-l10-and-rebuild/index.ts` — add `game-news-aggregator` invocation to refresh the cache

