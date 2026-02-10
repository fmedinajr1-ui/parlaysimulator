
# Fix: Prioritize High-Accuracy Categories in Parlay Generation

## The Problem

The bot knows THREE_POINT_SHOOTER hits at 75% and ELITE_REB_OVER hits at 20%, but both get included in parlays with nearly equal weight. The calibration data exists in `bot_category_weights` but barely influences which picks make it into parlays.

**Current weight impact on composite score:**
- Best category (weight 1.30): contributes ~87 points from weight component
- Worst unblocked (weight 0.76): contributes ~51 points from weight component  
- Difference: only ~36 points out of a multi-factor score -- easily overridden by odds or edge

**Categories that should be blocked but aren't:**
- ELITE_REB_OVER: 20% hit rate (5 samples)
- LOW_LINE_REBOUNDER: 37.5% hit rate
- NON_SCORING_SHOOTER: 42.9% hit rate

## The Fix

### 1. Auto-block underperformers (in `bot-generate-daily-parlays`)
Add a hard filter during prop pool building: any category with hit rate below 40% AND at least 10 verified outcomes gets excluded from the pool entirely. This prevents the composite score from accidentally including losing categories.

### 2. Boost top performers with a multiplier
Change the composite score formula to apply an exponential boost for high hit-rate categories:
- Categories above 65% hit rate get a 1.5x score multiplier
- Categories above 55% hit rate get a 1.2x multiplier
- Categories below 45% hit rate get a 0.5x penalty (in addition to blocking)

### 3. Add a "golden category" priority lane
When building parlays, ensure at least 2 of every 6 legs come from "golden" categories (hit rate above 60% with 20+ samples). Currently the interleave logic distributes evenly -- it should front-load proven winners.

### 4. Fix ELITE_REB_OVER and similar unblocked losers
Update the blocking threshold in `calibrate-bot-weights` to block any category below 40% with 10+ samples (currently requires 35% with 20 samples AND a 5-game losing streak -- too lenient).

## Technical Changes

### File: `supabase/functions/bot-generate-daily-parlays/index.ts`

**In `buildPropPool` function (~line 720-810):**
- Add a `blockedByHitRate` set built from `categoryWeights` where `current_hit_rate < 40` and sample size >= 10
- Filter out picks whose category is in this set
- Log how many picks were removed by this filter

**In `calculateCompositeScore` function (~line 342):**
- Add hit-rate tier multiplier:
  - hitRate >= 65: finalScore *= 1.5
  - hitRate >= 55: finalScore *= 1.2  
  - hitRate < 45: finalScore *= 0.5

**In parlay assembly logic:**
- Add a "golden picks first" rule: when selecting legs, prioritize picks from categories with 60%+ verified hit rate
- Ensure at least 2 golden-category legs per 6-leg parlay (when available)

### File: `supabase/functions/calibrate-bot-weights/index.ts`

- Lower the auto-block threshold from 35% (20 samples) to 40% (10 samples)
- This catches ELITE_REB_OVER (20%), LOW_LINE_REBOUNDER (37.5%), NON_SCORING_SHOOTER (42.9%)

## Expected Impact

Based on Feb 9 data:
- THREE_POINT_SHOOTER (75.2%) and HIGH_ASSIST_UNDER (75%) would dominate parlay legs
- ELITE_REB_OVER (20%) would be auto-blocked instead of dragging down parlays
- Estimated parlay hit rate improvement: current ~5% (1/21) could reach 15-20% with proper category weighting
