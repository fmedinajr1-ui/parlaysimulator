

## Problem: Kill Gate Flips Blindly in Both Directions

### What Went Wrong Tonight

Looking at the actual database records for April 2:

**Brandon Miller:**
- `velocity_spike` predicted **UNDER 28.5** PRA
- Kill gate caught it (velocity_spike on player prop) and blindly flipped UNDER → **OVER 28.5**
- Result: He got **25** — the original UNDER was correct, the flip lost

**Miles Bridges:**
- `velocity_spike` predicted **UNDER 21.5** PRA  
- Kill gate caught it and flipped UNDER → **OVER 21.5**
- Result: He got **32** — this one the flip happened to be right, but original logic was also wrong

### Root Cause

The kill gate at lines 243-292 flips ALL killed player prop signals **regardless of direction**. It does:
```
isOver → flip to UNDER
isUnder → flip to OVER   ← THIS IS WRONG
```

But the entire market trap theory says: **upward drift in player props is a public trap — OVERs are the bait.** Flipping an UNDER to OVER goes **against** the theory.

The historical data confirms this. For PTS+REB+AST combos:
- `line_about_to_move` **OVER**: 0% accuracy (0/10) — terrible, should fade
- `line_about_to_move` **UNDER**: 87.5% accuracy (7/8) — excellent, should keep
- `velocity_spike` **UNDER**: 20% accuracy (1/5) — bad, but flipping to OVER is worse

### Fix: Direction-Aware Kill Gate

**Rule change**: Kill gate fades should only flip **OVER → UNDER**. When the original signal is already UNDER:
1. Check side-specific accuracy for that signal+prop combo
2. If UNDER accuracy >= 50%: **keep it as-is** and route to best legs bucket
3. If UNDER accuracy < 50%: **skip entirely** (don't include in any parlay)
4. Never flip UNDER → OVER

### Changes

**File: `supabase/functions/generate-accuracy-flip-parlays/index.ts`**

1. Modify the kill gate block (lines 243-292):
   - If original prediction is OVER: flip to UNDER as before (trap theory)
   - If original prediction is UNDER: check side-specific accuracy from accMap
     - Good UNDER accuracy (>=50%): keep as UNDER, add to bestLegs
     - Bad UNDER accuracy (<50%): skip entirely, log as "no edge either way"

2. Same fix for cascade auto-flip block (lines 300-306): already correct (only flips OVER → UNDER)

3. For the normal bottom-performer flip classification (lines 371-377):
   - Add side-specific check: only flip if the *specific side's* accuracy is <=40%, not just overall accuracy
   - If OVER accuracy is 60% but UNDER accuracy is 20%, and signal says UNDER, flip UNDER→OVER is still valid
   - If OVER accuracy is 10% and signal says OVER, flip OVER→UNDER is valid

### Technical Detail

The `accMap` already tracks `over_wins`, `over_total`, `under_wins`, `under_total` (lines 110-147). The fix uses this existing side-level data to make direction-aware decisions instead of relying solely on overall accuracy.

