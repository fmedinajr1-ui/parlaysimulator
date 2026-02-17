
# Cap Any Single Team to Max 4 Parlays Per Day

## What's Happening Now

Today's data confirms the over-concentration problem:
- **SMU Mustangs**: appeared in 15 of 24 parlays (62%)
- **Florida Gators**: appeared in 10 of 24 parlays (42%)
- **Rhode Island Rams**: 9 of 24
- **NC State Wolfpack**: 9 of 24

The generator already has `globalGameUsage` (cap per game matchup) and `globalMatchupUsage` (cap per combination), but has no concept of per-team concentration. A dominant team like Florida or SMU can appear in the same game repeatedly across many parlay combinations.

## The Fix

Add a `globalTeamUsage` map — a third dimension of deduplication — right alongside the existing game and matchup caps.

### Cap Rules
- **Normal slates**: max **4 appearances** per team across the full daily parlay pool
- **Light slate mode**: max **6 appearances** per team (relaxed since fewer games are available)

### Where the Change Goes — `supabase/functions/bot-generate-daily-parlays/index.ts`

**Step 1 — Declare the global map** (line ~3399, next to existing globals):
```typescript
let globalGameUsage: Map<string, number> | undefined;
let globalMatchupUsage: Map<string, number> | undefined;
let globalTeamUsage: Map<string, number> | undefined;   // NEW
```

**Step 2 — Initialize on pipeline start** (line ~4914, next to existing resets):
```typescript
globalGameUsage = new Map();
globalMatchupUsage = new Map();
globalTeamUsage = new Map();   // NEW
```

**Step 3 — Check before accepting a parlay** (after the game usage check, ~line 3848):
```typescript
const MAX_TEAM_PARLAY_CAP = isLightSlateMode ? 6 : 4;
const teamKeys = legs
  .filter(l => l.type === 'team')
  .flatMap(l => [l.home_team, l.away_team])
  .filter(Boolean)
  .map(t => t.toLowerCase().trim());

let teamOverused = false;
for (const tk of teamKeys) {
  if (!globalTeamUsage) globalTeamUsage = new Map();
  if ((globalTeamUsage.get(tk) || 0) >= MAX_TEAM_PARLAY_CAP) {
    teamOverused = true;
    break;
  }
}
if (teamOverused) {
  console.log(`[Bot] Skipping ${tier}/${profile.strategy}: team concentration cap hit`);
  continue;
}
```

**Step 4 — Track usage after accepting** (after the fingerprint/mirror tracking, ~line 3870):
```typescript
for (const tk of teamKeys) {
  if (!globalTeamUsage) globalTeamUsage = new Map();
  globalTeamUsage.set(tk, (globalTeamUsage.get(tk) || 0) + 1);
}
```

## Technical Notes

- The `teamKeys` array extracts **both** `home_team` and `away_team` from every team-type leg — so both teams in a game count toward their respective caps
- On light slates (fewer than 10 qualifying picks), the cap relaxes from 4 to 6 to maintain parlay volume
- This operates at the **global pool level**, not within a single parlay — so Florida can still be in a 2-leg parlay but won't dominate the entire day's output
- The existing per-game cap (MAX_GAME_USAGE) and per-matchup cap (MAX_MATCHUP_USAGE) are unchanged — this new cap stacks on top as an additional filter

## Expected Result

After re-running the generator, today's parlays should have much better spread:
- No team appears more than 4 times (6 on light slates)
- More teams from the available 26 NCAAB games will be represented
- Parlay variety increases meaningfully for users browsing the dashboard
