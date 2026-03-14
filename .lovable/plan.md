

# Fix Calibration Engine — Tighter Blocking + Weight Overrides

## What's Wrong

The current `calibrate-bot-weights` function has loose thresholds:
- **Block threshold**: 40% hit rate — too lenient, letting categories like ML_FAVORITE (23.8%) slip through
- **Streak block**: -15 — way too generous, categories on -5 to -9 streaks keep playing
- No explicit force-block or force-boost logic for known problem/winner categories

## Changes

### File: `supabase/functions/calibrate-bot-weights/index.ts`

**1. Tighten blocking constants (lines 37-45):**
- `BLOCK_HIT_RATE_THRESHOLD`: 0.40 → **0.45** (block below 45%)
- `STREAK_BLOCK_THRESHOLD`: -15 → **-5** (block on 5+ consecutive misses)

**2. Add force-block and force-boost maps after the constants (~line 46):**

```typescript
// Hard overrides — categories that must be blocked regardless of calculated stats
const FORCE_BLOCKED: Set<string> = new Set([
  'ML_FAVORITE__home',
  'ML_FAVORITE__away',
]);

// Categories with proven high hit rates — boost weight to 1.40-1.50
const FORCE_BOOST: Record<string, number> = {
  'THREE_POINT_SHOOTER__over': 1.45,
  'LOW_SCORER_UNDER__under': 1.45,
  'HIGH_ASSIST__under': 1.20,  // Capped — actual hit rate is only 47%
  'LOW_LINE_REBOUNDER__under': 1.45,
};
```

**3. Apply force-block and force-boost in the upsert loop (after line 219):**

In the loop over `categoryMap`, after `shouldBlock()`:
- If the category key is in `FORCE_BLOCKED`, override `blockStatus` to `{ blocked: true, reason: 'Force-blocked: historically unprofitable' }`
- If the category key is in `FORCE_BOOST`, override `newWeight` to the boost value (but only if not blocked)
- For `HIGH_ASSIST__under` specifically, cap weight at 1.20 (matching its ~47% hit rate rather than letting the formula over-weight it)

**4. After the main upsert loop (~line 283), add a sweep pass:**

Query all `bot_category_weights` rows and force-block any that have:
- `current_hit_rate < 45` AND `total_picks >= 10`
- `current_streak <= -5`

This catches categories that exist in the DB but weren't in the current `categoryMap` (e.g., different sport scopes).

### Deployment
- Redeploy `calibrate-bot-weights` edge function
- Invoke it immediately to apply the fixes

## Summary of Threshold Changes

| Setting | Old | New |
|---|---|---|
| Block hit rate | 40% | 45% |
| Streak block | -15 | -5 |
| ML_FAVORITE | Active (0.02 weight) | Force-blocked |
| HIGH_ASSIST under | 1.47 weight | Capped at 1.20 |
| Top performers (>65%) | No boost | Boosted to 1.45 |

