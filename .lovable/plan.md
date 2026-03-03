

## Plan: Add Matchup-First Exploration Tier Profiles

### Problem
The exploration tier currently has ~80 profiles but none specifically target soft-defense matchups or same-team stacking. The matchup defense scan data is loaded and boosts individual picks (+12 prime, +6 favorable), but no strategy profile explicitly **requires** all legs to attack weak defenses or stack players from the same team exploiting a defensive gap.

### What Changes

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

#### 1. Add new strategy types to profile routing (~line 6098)
Add handling for two new strategies:
- `matchup_exploit` — All legs must have `matchupPriority === 'prime'` or `matchupPriority === 'favorable'` (defense rank 20+). Draws from `enrichedSweetSpots` filtered to only picks with `matchupBoost > 0`.
- `matchup_team_stack` — Same as `matchup_exploit` but additionally requires all legs share the same team. Targets WAS (#30), DET (#25-27), etc. by grouping matchup-boosted picks by team and building 3-leg same-team stacks.

#### 2. Add ~20 new exploration profiles (~line 675)
Insert into `TIER_CONFIG.exploration.profiles`:
```text
// MATCHUP-FIRST EXPLORATION: all legs attack weak defenses (rank 20+)
matchup_exploit × 6 profiles (3-leg NBA, sort by composite/hit_rate/shuffle)
matchup_exploit × 4 profiles (4-leg NBA, sort by composite/shuffle)

// SAME-TEAM STACKING: 3 players from same team vs soft defense
matchup_team_stack × 6 profiles (3-leg NBA, sort by composite/hit_rate/shuffle)

// MISPRICED + MATCHUP COMBO: mispriced edge AND defense rank 20+
matchup_mispriced × 4 profiles (3-leg NBA, sort by composite/shuffle)
```

#### 3. Strategy routing logic (~line 6098)
For `matchup_exploit`:
- Filter `enrichedSweetSpots` to only picks where `(pick as any).matchupBoost > 0` (i.e., picks that received the +12 or +6 matchup boost)
- Also include mispriced picks that have matchup boosts
- Sort by composite/hit_rate/shuffle per profile
- No additional composite gate beyond the existing tier minHitRate (45%)

For `matchup_team_stack`:
- Same matchup filter, then group by team abbreviation
- Only consider teams with 3+ matchup-boosted picks available
- Build parlay from the highest-scoring team group
- Ensures same-team stacking (e.g., 3 ORL players vs WAS)

For `matchup_mispriced`:
- Intersection of `mispricedPicks` pool AND `matchupBoost > 0`
- Combines the 0.5-line edge detection with defensive weakness targeting

#### 4. Add composite boost for elite defense rank (lines ~5452-5470)
Currently: +12 for prime (rank 20+), +6 for favorable
Change to: +22 for elite (rank 28+), +18 for prime (rank 25+), +12 for favorable (rank 20+)
This matches the memory spec and prioritizes the softest defenses (WAS #30, DET #25-27).

### Technical Details

- These profiles use the **existing** `matchupDefenseScan` data already loaded at line 3889
- The matchup boost tags (`matchupBoost`, `matchupPriority`) are already set on picks at lines 5443-5470
- No new database tables, edge functions, or API calls needed
- Same-team stacking uses the existing `team_name` / `team_abbrev` fields on enriched picks
- The exploration tier's existing diversity caps (maxPlayerUsage: 3, maxTeamUsage: 3) will be relaxed for `matchup_team_stack` profiles to `maxTeamUsage: 6` to allow same-team stacking

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add ~20 matchup-first exploration profiles, add 3 new strategy routing branches, upgrade matchup boost tiers to elite/prime/favorable |

