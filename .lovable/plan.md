

## Plan: Fix Lottery Scanner Accuracy

### Root Causes Identified
1. **No injury/lineup filtering** — scanner picks players who are OUT/DOUBTFUL
2. **Assists-heavy builds** — `player_assists OVER` legs fail frequently but aren't blocked
3. **Filler legs with 50% hit rate** — line 1041 allows fillers at just 50% hit rate (coin flips)
4. **L10 median too close to line** — picks where median is within 0.5 of the line are coin flips, not edges
5. **Too many tickets** — cap is 10 (line 221) but should be 5 max for lottery
6. **No "double confirm" requirement** — legs pass with just one signal (sweet spot OR mispriced), not both

### Changes — `supabase/functions/nba-mega-parlay-scanner/index.ts`

#### 1. Add Injury Filter (~line 190, after `today` declaration)
Query `lineup_alerts` for today, build exclusion set of OUT/DOUBTFUL players. Merge into `excludeSet` alongside existing player dedup.

#### 2. Block Assists OVER (~line 614, in POISON_FLIP_MAP)
Add `'assists': 'under'` and `'player_assists': 'under'` to the POISON_FLIP_MAP at line 32. This blocks all `assists OVER` picks from lottery tickets since they're historically the worst-performing legs.

#### 3. Raise Filler Hit Rate Floor
- Standard filler (line 1041): raise `hitRate < 50` → `hitRate < 65`
- Also require filler legs have L10 data: add `if (p.l10Avg === null) return false`

#### 4. Add Median-Line Proximity Gate (~line 923, in `passesBasicChecks`)
For player props, if L10 median is within 0.5 of the line, skip the pick — it's a coin flip. Look up median from `gameLogMap` or `sweetSpotMap` inside the check.

#### 5. Reduce Ticket Cap from 10 to 5
Line 221: change `existingLotteryParlays.length >= 10` → `>= 5`

#### 6. Require Double Signal for Standard Safe/Balanced Legs
- Safe candidates (line 996): already requires `sweetSpotSide === side || mispricedSide === side` — tighten to require BOTH (sweetSpotSide AND (mispricedSide or edgePct >= 5))
- Balanced candidates (line 1011): raise edge requirement from 5 to 8, or require sweet spot alignment too

### Summary

| Location | Change |
|----------|--------|
| Line 32-37 | Add `assists` and `player_assists` to POISON_FLIP_MAP |
| ~Line 195 | Add `lineup_alerts` query, merge OUT/DOUBTFUL into excludeSet |
| Line 221 | Cap from 10 → 5 |
| ~Line 923 | Add median proximity gate (skip if median within 0.5 of line) |
| Line 996 | Tighten safe leg to require double signal |
| Line 1041 | Raise filler hitRate from 50 → 65, require L10 data |
| Deploy + invoke | Re-deploy and re-run scanner for today |

