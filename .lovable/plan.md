
# Bankroll Doubler: 3-4 Leg Core Parlays + Daily Master Parlay with Defensive Matchup Filtering

## What the Bot Is Doing Wrong Right Now

The current system has **deep intelligence** but is leaving massive value on the table:

**Problem 1 - No 6-Leg Master Parlay**
The execution tier is capped at 3 legs across ALL profiles (lines 196-228). There is no "master parlay" profile anywhere in the system. The `TIER_CONFIG` execution profiles go up to 3 legs maximum. The `generateMonsterParlays` function creates 6-8 leg parlays at +10,000 to +25,000 but only fires on big-slate days with 15+ candidates. There is no structured bankroll-doubling 5-6 leg parlay targeting +500 to +2000 that runs every day.

**Problem 2 - Defensive Matchup Data Exists But Is NOT Used for Player Props**
The `nba_opponent_defense_stats` table has full defensive rankings (rank 1-30) for every NBA team across points, rebounds, and assists. The `fetch-team-defense-ratings` edge function has position-specific data (guards/wings/bigs). But when the bot selects player prop legs for parlays, it **never cross-references whether the opponent today is a good or bad defensive matchup**. It only uses l10 hit rate, category weight, and composite score. A pick like "Jaren Jackson Jr. rebounds over 2.5" sounds good but is useless if Memphis is playing Orlando (rank #1 rebounds defense).

**Problem 3 - 1-Leg Singles Still Leaking**
The single-pick fallback at line 5407 is still firing because the second execution run sees `allParlays.length < 1` locally (40 existing parlays don't count). This needs the `existingParlaysCount` guard to prevent 1-leg singles from polluting the board.

**Problem 4 - 2-Leg Whale Signal Profile Still in TIER_CONFIG**
Line 138 (exploration) still has `{ legs: 2, strategy: 'whale_signal', sports: ['all'] }` — one of the two 2-leg entries that needs permanent removal.

---

## The Real Intelligence Gap: What a Bankroll Doubler Looks Like

Given today's data, a proper 6-leg master parlay would look like this using the existing data layer:

**5 "Pours" (Player Props)** — from best archetype + hit rate + **FAVORABLE defensive matchup**:
1. THREE_POINT_SHOOTER over (75% hit rate) — only picks where opponent is ranked 20-30 in threes defense
2. ROLE_PLAYER_REB over (83% hit rate) — only picks where opponent is ranked 20-30 in rebounds defense  
3. BIG_ASSIST_OVER over (61% hit rate) — only picks where opponent allows 25+ assists per game (ranks 20-30)
4. HOT STREAK pick — BIG_REBOUNDER under (100% streak) — only picks where this specific player's matchup is SOFT
5. LOW_SCORER_UNDER under (65% hit rate) — vs top-12 points defense (matchup-confirmed)

**1 "Anchor Leg"** (team or high-confidence prop):
6. A 3-leg sub-parlay anchor from validated tier OR a team spread with a strong matchup signal

The result: odds in the +500 to +1500 range (bankroll doubling potential) with win probability around 15-25%.

---

## Technical Plan

### Change 1 — Add `masterParlay` Profile to Execution Tier in `TIER_CONFIG`

Add a dedicated 6-leg profile at the END of execution profiles:

```typescript
// MASTER PARLAY: 6-leg bankroll doubler with defense-filtered matchups
// Targets +500 to +2000 odds range. Requires 5 player props from different archetypes.
// ALL legs must pass defensive matchup validation before inclusion.
{ legs: 6, strategy: 'master_parlay', sports: ['basketball_nba'], minHitRate: 62, sortBy: 'hit_rate', useAltLines: false, requireDefenseFilter: true },
```

### Change 2 — Build `generateMasterParlay` Function

A new function inside `bot-generate-daily-parlays/index.ts` that:

1. **Loads today's opponent matchups** from `nba_opponent_defense_stats` — maps every player's opponent today to their defensive rank per stat category
2. **Filters candidates** through a `passesDefenseMatchup()` check:
   - For OVER picks: opponent must be ranked **17 or worse** (soft defense) for that stat type
   - For UNDER picks: opponent must be ranked **12 or better** (strong defense) for that stat type  
   - For HOT_STREAK picks: requires defensive matchup rank ≥ 18 (soft matchup to exploit the streak)
3. **Enforces archetype diversity**: max 1 leg per archetype in the master parlay
4. **Enforces team diversity**: max 1 player per team (no same-team correlated props)
5. **Targets 5 player prop legs + 1 team or high-confidence prop** leg
6. **Assigns to execution tier** with `$500 stake` and `is_simulated: false`

The function queries the `nba_opponent_defense_stats` table using each pick's `team_name` to find the opponent in today's games from `game_bets` or `game_environment`.

### Change 3 — Apply Defense Filter to ALL Execution Tier Picks (not just master parlay)

Modify the pick selection loop in `generateTierParlays()` for the execution tier to include a soft defense matchup bonus:

- When `profile.requireDefenseFilter === true`: hard filter (skip picks with bad matchup)
- For all execution tier profiles: apply a **composite score adjustment** based on defensive matchup:
  - Opponent defense rank 25-30 for that stat: `+8` composite bonus (very soft matchup)
  - Opponent defense rank 20-24: `+4` composite bonus (soft matchup)
  - Opponent defense rank 1-8: `-10` composite penalty (tough matchup — consider UNDER instead)
  - Opponent defense rank 9-15 for UNDER picks: `+6` bonus (strong defense confirms UNDER)

This uses the already-populated `nba_opponent_defense_stats` table that is never consulted during player prop selection today.

### Change 4 — Fix Single-Pick Fallback with `existingParlaysCount` Guard (line 5407)

The fingerprint pre-load section already queries all existing parlays. Capture the count:

```typescript
const existingParlaysCount = existingParlays?.length || 0;
```

Then at line 5407 change:
```typescript
// Before:
if (allParlays.length < 1) {

// After:
if (allParlays.length < 1 && existingParlaysCount < 6) {
```

This ensures: if 40 parlays already exist in the DB, the single-pick fallback never fires on a second run.

### Change 5 — Remove Both 2-Leg Whale Signal Profiles from `TIER_CONFIG`

- **Line 138** (exploration): Remove `{ legs: 2, strategy: 'whale_signal', sports: ['all'] }`
- **Line 222** (execution): Remove `{ legs: 2, strategy: 'whale_signal', sports: ['all'], minHitRate: 55, sortBy: 'composite' }`

The 3-leg whale signal profiles at lines 139 and (in execution) remain — they keep the whale signal strategy alive at a viable leg count.

---

## Master Parlay Defense Filter Logic (Core Algorithm)

```typescript
function getOpponentDefenseRank(
  playerTeam: string,        // e.g. "Minnesota Timberwolves"
  propType: string,          // e.g. "rebounds" 
  side: string,              // "over" | "under"
  opponentMap: Map<string, string>,           // team → opponent for today
  defenseMap: Map<string, Record<string, number>>  // team → { rebounds: rank, points: rank, ... }
): number | null {
  const opponent = opponentMap.get(playerTeam.toLowerCase());
  if (!opponent) return null;
  
  const ranks = defenseMap.get(opponent.toLowerCase());
  if (!ranks) return null;
  
  const propKey = propType.toLowerCase().includes('rebound') ? 'rebounds'
    : propType.toLowerCase().includes('assist') ? 'assists'
    : propType.toLowerCase().includes('three') ? 'threes'
    : 'points';
  
  return ranks[propKey] ?? null;
}

function passesDefenseMatchup(
  pick: EnrichedPick,
  opponentRank: number | null,
  side: string
): boolean {
  if (opponentRank === null) return true; // No data = don't block
  
  if (side === 'over') {
    // For OVER picks: need opponent defense rank >= 17 (weak defense)
    return opponentRank >= 17;
  } else {
    // For UNDER picks: need opponent defense rank <= 15 (strong defense)
    return opponentRank <= 15;
  }
}
```

---

## Files Changed

| File | Change | Lines |
|---|---|---|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add `master_parlay` 6-leg profile to execution tier TIER_CONFIG | ~228 |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add `generateMasterParlay()` function with defense matchup filter | new function ~3400 |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Apply defense matchup composite adjustments in execution tier pick loop | ~3300-3330 |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add `existingParlaysCount` guard to single-pick fallback (line 5407) | 5407 |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Remove 2-leg whale signal profiles from TIER_CONFIG | 138, 222 |

No migrations. No new tables. The `nba_opponent_defense_stats` table already exists and is populated. The master parlay reads from existing data infrastructure.

---

## Expected Daily Output After Fix

- **19+ execution 3-leg parlays** — unchanged, all with defense-matchup composite adjustments
- **1 execution 6-leg master parlay** — $500 stake, defense-filtered, +500 to +1500 odds, picks from 5 different archetypes confirmed by today's matchup
- **0 one-leg singles** — fallback guard prevents second-run flooding
- **0 two-leg parlays** — both whale signal 2-leg entries removed permanently

The master parlay specifically targets players whose archetype and today's L10 hit rate are both strong AND whose opponent today ranks 17-30 in that stat — meaning the edge is real, not just historical noise.
