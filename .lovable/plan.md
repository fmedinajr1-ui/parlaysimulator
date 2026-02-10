

# Fix: Tier Generation Creating Only 4 Instead of 65-75 Parlays

## Root Cause

The Sharpe ratio formula produces values in the **0.01-0.03 range**, but the tier thresholds require **0.1-0.5**. This makes it mathematically impossible for validation and execution tiers to produce any parlays, and most exploration profiles fail too.

**Math proof** (3-leg parlay, 55% hit rate, -110 odds):
- Combined probability: 0.55^3 = 0.166
- Implied probability: 0.524^3 = 0.144
- Edge: 0.022
- Sharpe: 0.022 / (0.5 x sqrt(3)) = **0.025**
- Exploration threshold: 0.1 -- FAILS
- Validation threshold: 0.4 -- impossible
- Execution threshold: 0.5 -- impossible

Only 4 exploration parlays sneak through because a few picks happen to have better odds than -110, pushing their edge/sharpe just above 0.1.

## Solution

Recalibrate the edge and sharpe thresholds to match what the formula actually produces. The formula itself is fine -- it correctly measures risk-adjusted edge. The thresholds just need to be realistic.

### New Thresholds

| Tier | Current minEdge | New minEdge | Current minSharpe | New minSharpe |
|------|----------------|-------------|-------------------|---------------|
| Exploration | 0.005 | 0.003 | 0.1 | 0.01 |
| Validation | 0.025 | 0.008 | 0.4 | 0.02 |
| Execution | 0.03 | 0.012 | 0.5 | 0.03 |

These still enforce a hierarchy (execution is 4x stricter than exploration) while being achievable with real data.

### Also fix: minConfidence filter

The `minConfidence` field on each tier (0.45, 0.52, 0.55) isn't used anywhere in the generation loop, so it's harmless. But the `minHitRate` on profiles IS enforced. Execution profiles require 55-62% hit rate while fallback picks have exactly 55% -- so profiles requiring 58% or 62% will always fail. Lower the strictest profile requirements slightly:

- `elite_conservative`: 62% down to 56%
- `elite_balanced`: 58% down to 55%
- `validated_conservative`: 58% down to 55%

## Technical Changes

### File: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Lines 57-58** (exploration tier thresholds):
- `minEdge: 0.005` to `minEdge: 0.003`
- `minSharpe: 0.1` to `minSharpe: 0.01`

**Lines 124-125** (validation tier thresholds):
- `minEdge: 0.025` to `minEdge: 0.008`
- `minSharpe: 0.4` to `minSharpe: 0.02`

**Lines 153-154** (execution tier thresholds):
- `minEdge: 0.03` to `minEdge: 0.012`
- `minSharpe: 0.5` to `minSharpe: 0.03`

**Lines 129-131** (validation profile minHitRate):
- `validated_conservative` profiles: `minHitRate: 58` to `minHitRate: 55`

**Lines 158-159** (execution profile minHitRate):
- `elite_conservative` profiles: `minHitRate: 62` to `minHitRate: 56`
- `elite_balanced` profiles: `minHitRate: 58` to `minHitRate: 55`

### Post-deploy

1. Trigger `bot-generate-daily-parlays` with `{"date": "2026-02-09"}` (today)
2. Verify all 3 tiers produce parlays (target: 50 exploration + 15 validation + 8 execution = 73)
3. Check Telegram `/parlays` shows the new full set

