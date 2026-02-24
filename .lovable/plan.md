

## Plan: Relax Risk Engine v4.7 Filters for Better Daily Volume

### Problem
The Risk Engine's 8-layer funnel with v4.7's stricter thresholds rejected ALL 4,063 props from 160 players today. Each filter is reasonable individually, but stacked together they create near-100% rejection rates, especially on lighter slates. This means no parlays reach the Telegram bot.

### Key Bottlenecks Identified

1. **Rebounds Dead Zone (lines 7-9.5)** blocks ALL rebounds in the most common line range, including elite rebounders like Joel Embiid (median 9.0, line 7.5)
2. **Sweet Spot v4.7 requirements** demand confidence >= 8.5 AND edge >= 1.5 AND L10 >= 70% -- too many simultaneous gates
3. **Points Mid-Tier Trap (15-21.5)** requires edge >= 2.0, blocking most star player points props
4. **Trap Line Block (45%+ deviation)** catches too many legitimate props (e.g., threes lines where median = 1.0 and line = 1.5 is only 0.5 apart)

### Proposed Changes

**File: `supabase/functions/nba-player-prop-risk-engine/index.ts`**

#### 1. Relax Rebounds Dead Zone for Elite Rebounders
- Currently: ALL rebounds in 7-9.5 range blocked regardless of archetype
- Change: Allow ELITE_REBOUNDER and GLASS_CLEANER archetypes through the 7-9.5 range when their median is >= 7 (they belong in this range)
- Impact: Joel Embiid rebounds 7.5 (median 9.0) would pass

#### 2. Lower Sweet Spot L10 Requirement
- Currently: Requires 70% L10 hit rate for sweet spot qualification
- Change: Lower to 60% L10 hit rate (still filters chronic underperformers)
- Config change: `SWEET_SPOT_REQUIREMENTS.minL10HitRate: 0.60` (was 0.70)

#### 3. Relax Points Mid-Tier Edge Requirement
- Currently: Lines 15-21.5 need edge >= 2.0
- Change: Lower to edge >= 1.5 for points in mid-tier (still above the standard 1.0 minimum)
- Line ~2352: Change `2.0` to `1.5`

#### 4. Fix Trap Line Detection for Low-Value Props
- Currently: A line of 1.5 vs median of 1.0 = 50% deviation = TRAP_LINE_BLOCK
- Change: For props where both line and median are <= 2.5, use absolute difference instead of percentage (since small numbers create inflated percentages). Allow if absolute diff <= 1.0
- This fixes threes/assists/blocks props being falsely flagged as traps

#### 5. Lower General Sweet Spot Confidence Minimum
- Currently: `minConfidence: 8.5`
- Change: `minConfidence: 8.0` (original v4.6 value)
- This allows a few more borderline picks through while still filtering low-quality ones

### Expected Impact
- These changes should allow approximately 10-25 picks through the funnel on a typical slate
- The downstream parlay generator will then have enough picks to build 3-5 quality parlays for Telegram
- Quality remains high -- we're only relaxing the most aggressive gates, not removing layers

### No Database Changes Required
All changes are in the edge function code only.

