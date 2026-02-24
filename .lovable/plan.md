

## Investigation Results: Why Some Picks Still Show defense=0.50

### Finding 1: All 0.50 Values Are From the Pre-Fix Run

The data in `bot_daily_parlays` for 2026-02-23 was generated **before** the lowercase fix was deployed. Every single leg shows `team_name: null` and `defense: 0.5`. The lowercase key fix has not yet been tested with a fresh parlay generation cycle.

### Finding 2: The Lowercase Fix Should Resolve Most Cases

The chain works like this:

```text
pick.team_name (e.g., "Memphis Grizzlies" from bdl_player_cache)
  -> normalizeBdlTeamName() -> "memphis grizzlies"
  -> defOpponentMap.get("memphis grizzlies") -> "detroit pistons" (from game_bets, stored lowercase)
  -> nameToAbbrev.get("detroit pistons") -> "DET" (NEW: lowercase key added by fix)
  -> defenseDetailMap.get("DET") -> { overall_rank: 9, opp_rebounds_rank: ..., opp_assists_rank: ... }
```

Before the fix, step 3 failed because `nameToAbbrev` only had `"Detroit Pistons"` (original case), not `"detroit pistons"`. The fix adds both.

### Finding 3: One Remaining Gap -- Missing team_name on Sweet Spot Picks

The `category_sweet_spots` table has **no `team_name` column**. The code resolves it via `playerTeamMap` (from `bdl_player_cache`) during enrichment at line 3408. However, if a player is NOT in `bdl_player_cache` (727 players currently cached), their `team_name` stays empty, and the entire defense lookup chain fails silently.

**Hardening fix**: Add a diagnostic log at the environment score enrichment point to surface which players have unresolved teams, AND add `playerTeamMap` as a secondary fallback at line 4266 (sweet spot defense enrichment) to match the pattern already used at line 4566 (mispriced defense enrichment).

### Proposed Changes

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

**Change 1 -- Sweet spot defense enrichment (line 4266): Add playerTeamMap fallback**

Currently:
```typescript
const teamKey = normalizeBdlTeamName((pick as any).team_name || '');
```

Should be:
```typescript
const resolvedTeam = (pick as any).team_name || playerTeamMap.get((pick.player_name || '').toLowerCase().trim()) || '';
const teamKey = normalizeBdlTeamName(resolvedTeam);
```

This matches the pattern already used at line 4566 for mispriced picks.

**Change 2 -- Add diagnostic logging to identify unresolved teams**

After the environment score enrichment loop, log how many picks had empty teamKey so we can track remaining gaps:
```typescript
// After the loop
let unresolvedTeamCount = 0;
// Inside loop: if (!teamKey) unresolvedTeamCount++;
if (unresolvedTeamCount > 0) {
  console.log(`[EnvironmentScore] WARNING: ${unresolvedTeamCount} picks had no resolved team_name`);
}
```

### Data Verification

All three data sources use consistent "City TeamName" format:
- `game_bets.home_team`: "Memphis Grizzlies"
- `team_defense_rankings.team_name`: "Memphis Grizzlies"  
- `nba_team_pace_projections.team_name`: "Memphis Grizzlies"
- `bdl_player_cache.team_name`: "Memphis Grizzlies" (except "LA Clippers" which `normalizeBdlTeamName` handles)

No format mismatches remain after the lowercase fix.

### Summary

The lowercase fix already deployed should resolve the vast majority of 0.50 defaults. The one additional hardening change (adding `playerTeamMap` fallback at line 4266) closes the only remaining gap. A fresh bot run after this change will confirm all defense factors are resolving correctly.
