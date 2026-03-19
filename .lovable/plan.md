

# Revert Lottery Scanner to March 1-4 Winning Logic

## Status: ✅ IMPLEMENTED

## Changes Applied (`supabase/functions/nba-mega-parlay-scanner/index.ts`)

1. **Filler hit rate**: 70% → **85%**
2. **Filler defense gate**: Added `defenseRank >= 20` requirement
3. **Balanced leg hit rate**: 60% → **75%**
4. **Fallback hit rate floor**: `stdAdj.minHitRate` (45%) → **80%**

## Pattern Being Enforced
Matches March 1 & March 4 winning blueprint:
- 3-leg structure, standard tier only
- Anchor: threes UNDER @ +154 with 100% hit rate
- Filler: 85%+ hit rate, weak defense (rank ≥ 20)
- All legs require strong L10 data
