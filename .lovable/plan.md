

# Tighten Perfect Line Scanner Tier Thresholds

## Current Problem

The existing tier thresholds let through too many weak signals. Data shows:

| Tier | Prop | Win% | Volume | Issue |
|------|------|------|--------|-------|
| PERFECT | Points | 50.0% | 6 | Coin flip |
| STRONG | Points | 59.4% | 32 | Below 65% |
| STRONG | Assists | 55.6% | 18 | Below 65% |
| STRONG | Spreads | 55.6% | 18 | Below 65% |
| LEAN | Assists | 40.0% | 5 | Terrible |

Meanwhile, PERFECT Moneyline (77%), PERFECT Spreads (71%), STRONG Moneyline (78%), and STRONG Threes (83%) are all strong.

Edge bucket analysis shows signals with <5% edge hit only 45-62%, while 5-10% edge hits 70-75%.

## Changes

**File**: `supabase/functions/perfect-line-scanner/index.ts`

### 1. Tighten Player Prop Tiers (~line 204)

**Current:**
```
PERFECT: ≥15% edge, floor ≥ line, ≥80% hit rate, ≥3 games
STRONG:  ≥10% edge, ≥65% hit rate, ≥2 games
LEAN:    ≥5% edge,  ≥55% hit rate, ≥2 games
```

**New:**
```
PERFECT: ≥18% edge, floor ≥ line, ≥85% hit rate, ≥3 games
STRONG:  ≥12% edge, ≥70% hit rate, ≥3 games
LEAN:    ≥7% edge,  ≥60% hit rate, ≥3 games
```

Key changes: raised all edge and hit-rate minimums, increased minimum games to 3 across all tiers to reduce small-sample noise.

### 2. Block Points and Assists from LEAN Tier (~line 207)

Add a prop-type gate after tier assignment — if prop is `player_points` or `player_assists` and tier is `LEAN`, skip. These two props underperform dramatically at LEAN level.

### 3. Tighten Team Market Tiers

**Totals** (~line 362): Raise PERFECT edge from 8→10, STRONG from 5→7, LEAN from 3→5. Raise all hit-rate thresholds by +5%.

**Moneyline** (~line 411): Already performing well — raise LEAN winPct gate from 0.50→0.55 to trim weakest entries.

**Spreads** (~line 464): Raise PERFECT edge from 6→8, STRONG from 4→6. Raise hit-rate thresholds by +3%.

## Expected Impact

- Cuts ~30-40% of low-quality LEAN/STRONG signals (the ones dragging accuracy down)
- Preserves high-performing Moneyline and Rebounds signals
- Overall win rate should climb from ~67% toward 72-75% range

