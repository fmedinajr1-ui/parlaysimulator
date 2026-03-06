

# Add Bench Player UNDER Recommendations to Bidirectional Scanner

## Problem
Currently the scanner only produces UNDER recommendations for "avoid" matchups (score ≤8). But bench players on teams in **any** matchup environment (even elite/prime) often have low individual ceilings — their lines are set too high relative to their actual production. The scanner ignores these entirely.

## Fix

### 1. Scanner: Add "contra-under" detection (`bot-matchup-defense-scanner/index.ts`)

For **every** matchup (not just avoid), also search `category_sweet_spots` for UNDER-side sweet spots on players from **both teams**. This catches:
- Bench players on good teams (e.g., WAS bench guy with 3.5 reb line but L10 avg of 2.1)
- Players facing elite defenses in specific stat categories

New logic after the existing `findPlayerTargets` call (line ~276):
```
// For any matchup tier, also find bench player UNDER targets
const underTargets = findPlayerTargets(attackerAbbrev, stat.key, 'under');
if (underTargets.length > 0) {
  // Create a separate "bench_under" recommendation
  allRecommendations.push({
    attacking_team: attackerAbbrev,
    defending_team: defenderAbbrev,
    prop_type: stat.key,
    side: 'under',
    matchup_label: 'bench_under',  // new label
    player_backed: true,
    player_targets: underTargets,
    ...
  });
}
```

### 2. Broadcast: Add new "BENCH UNDERS" section (`nba-matchup-daily-broadcast/index.ts`)

Add a dedicated section in the Telegram message after the existing tiers:
```
📉 BENCH PLAYER UNDERS (player-backed only)
  • Bub Carrington UNDER 3.5 REB vs UTA (L10: 2.1 avg, 80% hit, ceiling 3)
  • Anthony Gill UNDER 4.5 REB vs UTA (L10: 3.0 avg, 70% hit, ceiling 5)
```

Only include entries where `player_backed = true` — no environment-only unders.

### Files Changed
1. **`supabase/functions/bot-matchup-defense-scanner/index.ts`** — Add bench-under scanning for all matchup tiers, new `bench_under` label
2. **`supabase/functions/nba-matchup-daily-broadcast/index.ts`** — Add 📉 BENCH UNDERS section to Telegram output

