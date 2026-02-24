

## Fix Team Abbreviation Matching in Defense Rankings Lookup

### Root Cause

The environment score calculation defaults to 0.50 (neutral) for defense and reb/ast factors because of a **case mismatch** in map lookups:

1. `nameToAbbrev` stores keys in original case from the database (e.g., `"Memphis Grizzlies"`)
2. `defenseDetailMap` stores keys as abbreviations (`"MEM"`) and original case names (`"Memphis Grizzlies"`)
3. But when looking up a player's team, `normalizeBdlTeamName()` returns **lowercase** (e.g., `"memphis grizzlies"`)
4. `nameToAbbrev.get("memphis grizzlies")` returns `undefined` because the key is `"Memphis Grizzlies"`
5. Without a valid abbreviation, `defenseDetailMap.get("")` also fails, so defense defaults to neutral

### The Fix

Store **lowercase** keys alongside original keys in both `nameToAbbrev` and `defenseDetailMap` when building the lookup maps. This is a minimal, surgical fix -- just add `.toLowerCase()` variants during map population.

### File: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Change 1 -- Pace/nameToAbbrev population (~line 3212)**

When inserting into `nameToAbbrev` from pace data, also insert lowercase:
```typescript
if (p.team_name) {
  nameToAbbrev.set(p.team_name, p.team_abbrev);
  nameToAbbrev.set(p.team_name.toLowerCase(), p.team_abbrev);
}
```

**Change 2 -- Defense/nameToAbbrev + defenseDetailMap population (~lines 3224-3230)**

When inserting from defense rankings, also insert lowercase keys:
```typescript
if (d.team_name) {
  nameToAbbrev.set(d.team_name, d.team_abbreviation);
  nameToAbbrev.set(d.team_name.toLowerCase(), d.team_abbreviation);
  const detail = { overall_rank: d.overall_rank, opp_rebounds_rank: d.opp_rebounds_rank, opp_assists_rank: d.opp_assists_rank };
  defenseDetailMap.set(d.team_name, detail);
  defenseDetailMap.set(d.team_name.toLowerCase(), detail);
}
```

### Impact

- Memphis Grizzlies (Rank 5) will now correctly resolve to `"MEM"` and pull `overall_rank: 5`, producing a defense factor of **0.14** instead of the neutral **0.50**
- All 30 NBA teams will have proper defense and reb/ast factors in environment scoring
- Both sweet spot and mispriced pick enrichment paths benefit since they share `nameToAbbrev` and `defenseDetailMap`

### Deployment

Only `bot-generate-daily-parlays` needs redeployment. `prop-engine-v2` already stores lowercase keys (line 690) and does not have this bug.

