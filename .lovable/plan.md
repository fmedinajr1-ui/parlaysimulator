

# Fix 9% Execution Hit Rate — Root Cause Analysis and Adjustments

## Key Findings from Data (Mar 15–27)

### The Core Problem: Volume Imbalance
**95 out of 132 settled parlays (72%) are `optimal_combo` exploration** — a single strategy dominates the pipeline and drags down the overall win rate.

```text
Strategy                         Won  Lost  Win%
────────────────────────────────────────────────
cross_sport (exploration)         3     1    75%
shootout_stack (execution)        2     1    67%
floor_lock (exploration)          3     2    60%
props_only (exploration)          1     1    50%
ceiling_shot (exploration)        1     1    50%
sweet_spot_l3                     1     2    33%
l3_cross_engine                   2     5    29%
grind_stack (execution)           1     4    20%
optimal_combo (exploration)      16    79    17%  ← THE PROBLEM
role_stacked_5leg                 0     3     0%
role_stacked_8leg                 0     2     0%
mega_lottery_scanner              0     1     0%
```

**Optimal combo alone accounts for 79 of 102 total losses.**

### Leg-Level Category Performance
Some categories are poisoning parlays:
```text
Category            Hits  Misses  Hit%
─────────────────────────────────────
BIG_ASSIST_OVER       0      6     0%   ← BLOCK
REBOUNDS              1      7    13%   ← BLOCK
POINTS (raw)          1      4    20%   ← weak
HIGH_REB_UNDER        2      5    29%   ← BLOCK
ROLE_PLAYER_REB      13     16    45%   ← below threshold
MID_SCORER_UNDER      9      9    50%   ← marginal
─────────────────────────────────────
THREE_POINT_SHOOTER  46     33    58%   ← good
VOLUME_SCORER        27     17    61%   ← good
BIG_REBOUNDER        29     18    62%   ← good
HIGH_ASSIST          40     21    66%   ← great
STAR_FLOOR_OVER      29      2    94%   ← elite
```

### Parlay Size Problem
```text
Legs  Won  Lost  Win%
──────────────────────
2       2     0   100%
3      25    78    24%
4       1    14     7%
5       2     8    20%
8       0     2     0%
```
4-leg parlays are hitting at 7% — the minHitRate threshold (55% per leg) is too low for 4-leggers.

### Confidence vs Reality
Legs with confidence ≥ 0.75 hit at ~65%. Legs with confidence 0.55–0.65 hit at ~47% — essentially a coin flip. The system is including too many low-confidence legs.

## Plan — 5 Changes

### 1. Cap `optimal_combo` exploration volume
Currently unlimited; it generates 10–15 parlays per day. Cap it to **max 5 per day** so it doesn't drown out better strategies.

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`
- Add a counter for optimal_combo in the exploration profiles
- Skip profile once 5 are created

### 2. Block toxic categories
Add `BIG_ASSIST_OVER`, `REBOUNDS` (raw), `HIGH_REB_UNDER`, and `uncategorized` to the blocked category list. These have sub-30% leg hit rates.

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`
- Add to the category block list alongside existing steals/blocks blocks

### 3. Raise minimum hit rate thresholds
- Exploration `optimal_combo` 3-leg: 60% → **65%**
- Exploration `optimal_combo` 4-leg: 55% → **62%**
- All exploration profiles: raise floor from 55% → **60%** minimum confidence

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

### 4. Kill 4-leg exploration parlays (temporarily)
At 7% win rate, 4-leg exploration parlays are net negative. Remove all 4-leg exploration profiles until the system calibrates better. Keep 4-leg execution profiles (higher thresholds).

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

### 5. Kill `role_stacked_5leg` and `role_stacked_8leg`
0% win rate on 5 parlays. These high-leg-count strategies are too speculative.

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts` or `nba-mega-parlay-scanner/index.ts`
- Remove or disable these strategy profiles

## Summary of Expected Impact
- Eliminates ~60% of losing volume (optimal_combo overproduction + toxic categories)
- Raises the quality floor for remaining parlays
- Shifts mix toward proven strategies (floor_lock, cross_sport, shootout)
- Expected win rate improvement: 17% → 30–40% range

## Files Changed
1. `supabase/functions/bot-generate-daily-parlays/index.ts` — all 5 changes

