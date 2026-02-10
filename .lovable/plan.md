
# Fix Team Prop Logic -- Add Real Intelligence and Conflict Prevention

## The Problems

1. **Contradictory legs**: A single parlay contains OVER 229.5 AND UNDER 229.5 for the same game (guaranteed loss). No same-game conflict check exists.
2. **Duplicate game_bets rows**: Multiple rows for the same game/bet_type create inflated pick pools (e.g., 3 different HOU/LAC spread entries).
3. **No real analysis**: Team picks use a hardcoded `sharp_score || 50` with a flat `+20` bonus. No defensive rankings, pace data, game environment, home court advantage, or ATS history is consulted.
4. **Duplicate same-team legs**: Indiana Pacers Spread 11.5 appears twice in the same parlay (screenshot).

## What Changes

### 1. Add same-game conflict detection in `bot-generate-daily-parlays/index.ts`

Before adding a team leg to a parlay, check:
- No opposite-side leg for the same game already exists (prevents Over + Under on same total, or Home + Away spread on same game)
- No duplicate team leg (same game + same bet_type + same side)

This is a new validation inside `canUsePickInParlay` and the parlay assembly loop. A `parlayGameSides` map will track `game_id -> bet_type -> side` to block conflicts.

### 2. Deduplicate game_bets before enrichment

Before building `enrichedTeamPicks`, deduplicate `game_bets` by `game_id + bet_type`, keeping only the most recently updated row. This prevents the same spread/total from generating 2-3 redundant legs.

### 3. Add real team scoring using existing data

Replace the `sharp_score + 20` formula with actual intelligence from tables that already exist:

| Data Source | Table | What It Provides |
|---|---|---|
| Pace projections | `nba_team_pace_projections` | Pace rating, tempo factor for totals |
| Defense rankings | `team_defense_rankings` | Overall rank (1-30) for spread/ML |
| Game environment | `game_environment` | Vegas total, spread, game script, blowout probability |
| Home court stats | `home_court_advantage_stats` | Home cover rate, home win rate, over rate |

The new `calculateTeamCompositeScore` function will:

**For Spreads:**
- Use defense rank differential (better defense = higher confidence on their side)
- Use home court cover rate (home_cover_rate from `home_court_advantage_stats`)
- Use game environment blowout probability (high blowout = favor favorite spread)
- Penalize close spreads (< 3 pts) as low-confidence

**For Totals:**
- Use combined pace ratings of both teams (FAST+FAST = favor over, SLOW+SLOW = favor under)
- Use game environment `shootout_factor` vs `grind_factor`
- Use home court `home_over_rate`
- Cross-reference with `vegas_total` from game_environment

**For Moneylines:**
- Use defense rank differential
- Use home court win rate
- Penalize heavy favorites (implied prob > 75%) as low-value

### 4. Wire up data fetching

In `buildPropPool`, add parallel fetches for:
- `nba_team_pace_projections` (all teams, current season)
- `team_defense_rankings` (current season)
- `game_environment` (today's game date)
- `home_court_advantage_stats` (basketball_nba)

These are lightweight lookups (30 teams each) that won't impact performance.

## Technical Details

### Conflict prevention logic (new helper)

```text
function canAddTeamLegToParlay(
  newLeg: EnrichedTeamPick,
  existingLegs: (EnrichedPick | EnrichedTeamPick)[]
): boolean {
  for (const existing of existingLegs) {
    if existing is not a team leg, skip
    
    if same game (home_team + away_team match):
      if same bet_type:
        BLOCK (no two spread legs or two total legs from same game)
      if different bet_type but would create logical conflict:
        Allow (spread + total from same game is fine)
  }
  return true
}
```

### Deduplication logic

```text
// Before enrichment, deduplicate by game_id + bet_type
const seenGameBets = new Map<string, TeamProp>();
for (const game of teamProps) {
  const key = `${game.home_team}_${game.away_team}_${game.bet_type}`;
  const existing = seenGameBets.get(key);
  if (!existing || game.updated_at > existing.updated_at) {
    seenGameBets.set(key, game);
  }
}
const dedupedTeamProps = Array.from(seenGameBets.values());
```

### New composite score formula

```text
function calculateTeamCompositeScore(
  game: TeamProp,
  betType: string,
  side: string,
  paceMap: Map<string, PaceData>,
  defenseMap: Map<string, number>,  // team -> rank 1-30
  envMap: Map<string, GameEnv>,
  homeCourtMap: Map<string, HomeCourtStats>
): number {
  let score = 50; // baseline
  
  if (betType === 'spread') {
    // Defense rank edge: team with better defense gets +15
    // Home court cover rate > 55% gets +10
    // Blowout probability > 30% on favorite side gets +10
  }
  
  if (betType === 'total') {
    // Combined pace: both FAST (>101) = +15 for over
    // Both SLOW (<99) = +15 for under
    // Shootout factor > 0.3 = +10 for over
    // Grind factor > 0.8 = +10 for under
  }
  
  if (betType === 'moneyline') {
    // Defense rank differential
    // Home win rate
    // Penalize heavy juice (implied > 75%)
  }
  
  return clamp(30, 95, score);
}
```

### Files modified

1. `supabase/functions/bot-generate-daily-parlays/index.ts`
   - Add data fetches for pace, defense, environment, home court
   - Add `calculateTeamCompositeScore` function
   - Add `canAddTeamLegToParlay` conflict check
   - Add deduplication of `game_bets` rows
   - Replace hardcoded `sharp_score + 20` with real composite scoring
   - Wire conflict check into parlay assembly loop
