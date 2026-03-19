

# Revert Lottery Scanner to March 1-4 Winning Logic

## What Won (March 1 & March 4 — only 2 standard lottery wins ever)

Both winning tickets share an identical blueprint:

| Attribute | March 1 Winner (+1052) | March 4 Winner (+1096) |
|-----------|----------------------|----------------------|
| Legs | 3 | 3 |
| Anchor leg | Threes UNDER @ 1.5 line, 100% hit rate, +154 odds | Threes UNDER @ 1.5 line, 100% hit rate, +154 odds |
| Filler hit rates | 89%, 100% | 90%, 88% |
| Filler defense ranks | 25, 27 | 26, 26 |
| Filler L10 avg vs line | 2.3 vs 1.5 (53% above), 5.6 vs 5.5 | 5.1 vs 5.5, 6.8 vs 6.5 |
| All FanDuel | Yes | Yes |

## What Lost (March 5-13 — every ticket since)

The losing legs share common flaws:
- **Filler hit rates dropped to 70-80%** (Cade Cunningham 80% missed badly: 17 vs 24.5 line)
- **Weak defense matchups ignored**: some filler legs had defense_rank 8-17 (strong defense = bad matchup for OVER)
- **Tight margins**: L10 avg barely above line on OVER picks

## Root Cause: 3 filter thresholds are too loose

The current code accepts:
1. **Filler hit rate ≥ 70%** (line 1131) — winners needed **88%+**
2. **No defense rank floor on fillers** — winners always had **defense_rank ≥ 22** (weak opponent)
3. **Filler edge requirement ≥ 3%** — this is fine but masks the real issue above

## Changes (File: `supabase/functions/nba-mega-parlay-scanner/index.ts`)

### Fix 1: Raise filler leg hit rate from 70% to 85%
Line 1131: change `p.hitRate < 70` → `p.hitRate < 85`

### Fix 2: Require weak defense matchup on filler legs (defense_rank ≥ 20)
Add after the existing filler hit rate check: `if (p.defenseRank !== null && p.defenseRank < 20) return false;`

### Fix 3: Raise balanced leg hit rate from 60% to 75%
Line 1099: change `p.hitRate < 60` → `p.hitRate < 75`

### Fix 4: Require defense_rank ≥ 18 on balanced legs (already exists but at 18 — keep as-is)
No change needed here — line 1101 already has `p.defenseRank < 18`.

### Fix 5: Tighten fallback hit rate floor
Line 1147: the fallback uses `stdAdj.minHitRate` (45%). Change the fallback to also require `p.hitRate >= 80` to prevent low-confidence legs sneaking in.

## What This Preserves
- The "great_odds" anchor leg selection (threes UNDER at +154) — unchanged
- The SAFE leg criteria (70% hit rate + edge + sweet spot alignment) — unchanged
- 3-leg structure, standard tier only — unchanged
- All scoring, alt-line hunting, poison flip logic — unchanged

## Expected Outcome
Lottery tickets will only generate when there are enough high-confidence legs with favorable matchups — matching exactly the pattern that produced the two wins.

