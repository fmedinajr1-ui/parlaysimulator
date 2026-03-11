

## Fix: Add Streak Penalty to Weight Calibration

### Problem
The `calculateWeight()` function in `calibrate-bot-weights` only considers two inputs: **historical hit rate** and **sample size**. It completely ignores `current_streak`. A category like `THREE_POINT_SHOOTER` with a high all-time hit rate (e.g., 65%) keeps its weight at 1.30 even during a -12 cold streak because the streak data is stored but never used in the weight formula.

```text
Current formula:
  weight = clamp(0.5, 1.5, 1.0 + (hitRate - 0.50) * 0.8 + sampleBonus)
  → streak is ignored entirely

Fixed formula:
  weight = clamp(0.5, 1.5, 1.0 + (hitRate - 0.50) * 0.8 + sampleBonus + streakPenalty)
  
  streakPenalty (only for negative streaks):
    streak <= -3:  penalty = streak * 0.02  (e.g., -5 streak → -0.10)
    streak <= -8:  penalty = streak * 0.03  (e.g., -12 streak → -0.36)
    streak <= -15: auto-block the category
```

### Changes

**File: `supabase/functions/calibrate-bot-weights/index.ts`**

1. Add streak penalty constants and a `calculateStreakPenalty()` function
2. Modify `calculateWeight()` to accept `currentStreak` and apply the penalty
3. Add streak-based auto-blocking in `shouldBlock()` — any category with streak <= -15 gets blocked regardless of hit rate
4. Pass `existing.current_streak` into both functions during the calibration loop (~line 197)

This ensures that even a historically strong category gets its weight dragged down during an extended cold streak, and gets auto-blocked if it reaches -15.

### Example Impact
- `THREE_POINT_SHOOTER` at 65% hit rate, -12 streak:
  - **Before**: weight = 1.0 + (0.65 - 0.50) * 0.8 + 0.10 = **1.22** (rounded to ~1.30 with other bonuses)
  - **After**: weight = 1.22 + (-12 * 0.03) = 1.22 - 0.36 = **0.86**
  - Significant reduction, still eligible but deprioritized

