# ✅ IMPLEMENTED: Starter Protection for UNDER Picks

## Summary
Implemented v7.0 filters to prevent UNDER recommendations on star/starter players. All changes are now live.

## Changes Made

### 1. ✅ Disabled MID_SCORER_UNDER Category
**File**: `supabase/functions/category-props-analyzer/index.ts`
- Added `disabled: true` to MID_SCORER_UNDER config
- This category had 45% hit rate - a losing strategy

### 2. ✅ Added Minutes-Based Filter for Points UNDER
**File**: `supabase/functions/category-props-analyzer/index.ts`
- Players averaging 28+ minutes are blocked from ALL points UNDER categories
- Starters can explode any night - not safe for UNDER bets
- Logs blocked players for debugging

### 3. ✅ Added Archetype Restrictions to NON_SCORING_SHOOTER
**File**: `supabase/functions/category-props-analyzer/index.ts`
- Added `blockedArchetypes: ['PURE_SHOOTER', 'COMBO_GUARD', 'SCORING_GUARD', 'PLAYMAKER']`
- Prevents scorers from being recommended for points UNDER

### 4. ✅ Strengthened determineOptimalSide in useDeepSweetSpots.ts
**File**: `src/hooks/useDeepSweetSpots.ts`
- Now checks production metrics (avgMinutes + statPerMinute)
- Forces OVER for players with 28+ min avg AND 0.45+ stat per minute
- Prevents client-side UNDER picks on starters

### 5. ✅ Removed MID_SCORER_UNDER from UI Display
**File**: `src/components/market/SweetSpotPicksCard.tsx`
- Removed from CATEGORY_CONFIG display map
- Added comment explaining why it's disabled

---

## Validation Rules Now Active

For any points UNDER pick:
1. ✅ Category must NOT be MID_SCORER_UNDER (disabled)
2. ✅ Player must average < 28 minutes (not a starter)
3. ✅ Player must NOT have scorer archetype
4. ✅ L10 Max must be < 1.3x the line (existing ceiling protection)

---

## Expected Outcome

- ❌ No more starter-level UNDER recommendations
- ✅ Points UNDER focused on true role players (12 ppg, 20 min)
- 📈 Expected hit rate improvement: 45% → 60%+ (matching LOW_SCORER_UNDER)
