

# Expand Execution Tier: Team Props + Relaxed Golden Gate

## What Changes

### 1. Add mixed execution profiles that include team props
Add 3 new execution profiles that combine player props with team legs (spreads, totals, moneylines). These "hybrid" profiles will pull from both the player prop pool and the team prop pool, increasing the combinatorial space and reducing duplicate parlays.

New profiles added to the execution tier:
- 3-leg hybrid: 2 player props + 1 team prop (spread/total/ML)
- 3-leg hybrid: 2 player props + 1 team prop (cross-sport)
- 3-leg team-only: 3 team legs (ML/spread/total mix)

### 2. Relax Golden Gate to allow 1 non-golden leg
Change the Golden Gate formula from `minGoldenLegs = Math.floor(profile.legs / 2)` to `minGoldenLegs = profile.legs - 1`. For 3-leg parlays, this means 2 of 3 legs must be golden (currently it's also `floor(3/2) = 1`, so this actually tightens it slightly for player legs while exempting team legs from the golden check entirely).

More precisely: team legs will be excluded from the golden gate count since they don't have sweet-spot categories. The gate will only apply to player legs in the parlay.

### 3. Build hybrid candidate pools
For hybrid profiles, the candidate selection logic will merge player props and team props into a single pool, with player props prioritized first (sorted by hit rate), then team props appended (sorted by composite score). The existing `canAddTeamLegToParlay` conflict detection ensures no contradictory same-game bets.

## Technical Details

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Execution profiles** (lines 173-187) -- add 3 hybrid profiles:
```typescript
// HYBRID: Mix player props + team props for diversity
{ legs: 3, strategy: 'hybrid_exec', sports: ['basketball_nba'], minHitRate: 60, sortBy: 'hit_rate', useAltLines: false, allowTeamLegs: 1 },
{ legs: 3, strategy: 'hybrid_exec_cross', sports: ['all'], minHitRate: 58, sortBy: 'hit_rate', useAltLines: false, allowTeamLegs: 1 },
// TEAM EXECUTION: Pure team props with high composite scores
{ legs: 3, strategy: 'team_exec', betTypes: ['moneyline', 'spread', 'total'], minHitRate: 55 },
```

**Candidate pool logic** (around line 1525) -- add hybrid pool building:
- When `profile.allowTeamLegs` is set, build candidates from player props first, then append top team props
- Cap team legs per parlay at `profile.allowTeamLegs` (default 1)

**Golden Gate** (lines 1688-1695) -- exempt team legs:
- Only count player legs toward the golden gate requirement
- Team legs pass through without needing a golden category

**Profile type** (line 36) -- add `allowTeamLegs?: number` to the profile interface

After deploying, run `bot-generate-daily-parlays` for Feb 12 to fill out the execution tier with the new hybrid profiles.

