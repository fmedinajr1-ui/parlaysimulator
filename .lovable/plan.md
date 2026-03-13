

## Plan: Unblock Execution & Validation Tiers to Reach 25+ Parlays

### Root Cause
The `canUsePickGlobally` function (line 3430-3433) has a **70% confidence_score gate** applied to ALL non-sweet-spot profiles. This is the primary bottleneck:

- **400 sweet spot picks** available (March 12 data)
- Only **78 picks** (19.5%) have `confidence_score >= 0.70`
- But **286 picks** (71.5%) have `l10_hit_rate >= 0.80`

The confidence gate is redundant and over-restrictive. Execution tier already has its own dedicated **80% L10 hit rate gate** (line 7962-7971), which is the correct quality filter. The global confidence gate blocks picks before they even reach the tier-specific gates.

This means strategies like `god_mode_lock`, `cash_lock`, `golden_lock`, `double_confirmed_conviction`, `hot_streak_lock`, `grind_under_core`, `mixed_conviction_stack`, `triple_confirmed_conviction`, etc. are all starved of picks.

### Fix

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

1. **Remove the redundant 70% confidence gate** in `canUsePickGlobally` (lines 3427-3434). Each tier already has proper quality controls:
   - Execution: 80% L10 hit rate gate + defense hard-blocks + threes L10 floor
   - Validation: profile-level `minHitRate` (55-65%) + tier-level `minConfidence: 0.52`
   - Exploration: profile-level `minHitRate` (42-55%) + tier-level `minConfidence: 0.45`

2. **Replace with tier-appropriate confidence floors** applied during the main pick loop (not in the global gate):
   - Execution: rely on existing L10 80% gate (already implemented)
   - Validation: use the existing `minConfidence: 0.52` from tier config
   - Exploration: use the existing `minConfidence: 0.45` from tier config

   The per-profile `minHitRate` and the per-tier `effectiveMinHitRate` check at line 7976-7979 already handle this correctly.

### Impact
- Execution tier picks pool goes from ~78 to ~286 (after L10 80% gate)
- Validation tier picks pool goes from ~78 to ~252+ (after profile minHitRate)
- Combined with cap-of-3 exposure and shuffle profiles, this should easily produce 25+ unique parlays

### After Deploy
- Void today's (empty) slate, regenerate fresh
- Run diversity rebalance
- Verify no player+prop+side exceeds cap of 3

