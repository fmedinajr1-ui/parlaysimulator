

# Fix: Pitcher Lookup Returns Wrong Pitcher (Batter's Own Team)

## Problem
The `findPitcherForPlayer` function in `generate-rbi-parlays` finds a pitcher by searching the event description (e.g. "Toronto Blue Jays @ Cleveland Guardians") for any team name in the pitcher map. Since **both** team names appear in the description, it returns whichever team name it finds first — which could be the batter's **own** team's pitcher instead of the opposing pitcher.

This is why Yoan Moncada shows "Facing Reid Detmers" — Detmers pitches for the same team (Angels/White Sox context), not the opponent.

## Root Cause
In `fetchTodayPitchers()`, the map is keyed by `facingTeam` (the team whose batters face that pitcher). But `findPitcherForPlayer()` has no idea which team the batter plays for — it just does `lower.includes(team)` on the full event string, matching the first team it finds.

## Fix

### File: `supabase/functions/generate-rbi-parlays/index.ts`

**1. Change the pitcher map to be keyed by the batter's team name** (the team whose batters face that pitcher — which is already what `facingTeam` represents). The map key is correct; the lookup is wrong.

**2. Add batter team resolution** — determine which team the batter plays for, then look up `pitcherMap.get(batterTeam)` directly instead of scanning both teams.

To determine the batter's team:
- Check `alert.metadata?.team` (already stored by the RBI analyzer)
- If not available, query `mlb_player_game_logs` for the player's most recent team
- Use the resolved team name to do an exact lookup in `pitcherMap`

**3. Update `findPitcherForPlayer` signature and logic:**

```typescript
function findPitcherForPlayer(
  pitcherMap: Map<string, PitcherStats>,
  batterTeam: string | null,
  eventDescription: string,
): PitcherStats | null {
  // Exact match on batter's team (map is keyed by facingTeam = batter's team)
  if (batterTeam) {
    const lower = batterTeam.toLowerCase();
    for (const [team, stats] of pitcherMap) {
      if (team.includes(lower) || lower.includes(team)) return stats;
    }
  }
  
  // Fallback: parse event description "Away @ Home" and try both
  // But we need to know which side the batter is on
  return null;
}
```

**4. Pass batter team from alert metadata or game logs** in the pitcher gate loop (lines 170-218). Add a batch team lookup from `mlb_player_game_logs` for players missing team metadata.

### Impact
This ensures Bo Bichette (Blue Jays) gets matched to Cleveland's pitcher, and Yoan Moncada gets matched to the opposing pitcher — not their own team's starter.

