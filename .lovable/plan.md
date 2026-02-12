

# Fix: Auto-Flip Logic Bug (no_data Contamination)

## Problem
The `autoFlipUnderperformingCategories` function in `category-props-analyzer` has a critical bug: it includes `no_data` outcomes in the total count when calculating hit rates, but doesn't count them as hits. This deflates every category's hit rate by 30-60%, causing 6 of 8 categories to be incorrectly flipped to the "under" side -- including categories with 55-60% true win rates.

## Impact
- **ROLE_PLAYER_REB** (60% true hit rate) was demoted to weight 0.50
- **BIG_ASSIST_OVER** (57.6%), **BIG_REBOUNDER** (55.7%), **STAR_FLOOR_OVER** (54.8%) all incorrectly penalized
- **THREE_POINT_SHOOTER** (78.8% true rate!) was calculated at 43.2% and nearly flipped
- Tomorrow's parlay generation would exclude or underweight these profitable categories

## Fix (2 Steps)

### Step 1: Fix the auto-flip function
In `supabase/functions/category-props-analyzer/index.ts`, update `autoFlipUnderperformingCategories` to:
- Only count `hit` and `miss` outcomes (exclude `no_data`, `push`, `void`)
- Match the same logic used in `calibrate-bot-weights` which correctly does `hitRate = hits / (hits + misses)`

```text
Current (buggy):
  s.total++                        <-- counts ALL outcomes including no_data
  if (row.outcome === 'hit') s.hits++

Fixed:
  if (row.outcome === 'hit') { s.hits++; s.graded++; }
  else if (row.outcome === 'miss') { s.graded++; }
  // skip no_data, push, void
  hitRate = s.hits / s.graded      <-- only graded picks
```

### Step 2: Restore incorrectly flipped category weights
Run a database correction to restore the 6 incorrectly flipped categories:
- **BIG_ASSIST_OVER** over: restore weight from 0.50 to calibrated value
- **BIG_REBOUNDER** over: restore weight
- **LOW_LINE_REBOUNDER** over: restore weight
- **ROLE_PLAYER_REB** over: restore weight
- **STAR_FLOOR_OVER** over: restore weight
- **VOLUME_SCORER** over: restore weight (this one is borderline at 51.2%, may still warrant monitoring)
- Keep **HIGH_ASSIST** over at 0.50 (legitimate flip at 49.6%)

Weights will be restored by triggering `calibrate-bot-weights` after the code fix, which already uses correct hit rate math.

### Technical Details
- File changed: `supabase/functions/category-props-analyzer/index.ts` (the `autoFlipUnderperformingCategories` function)
- Deploy updated edge function
- Run `calibrate-bot-weights` to restore correct weights from the accurate hit rate calculations
- Optionally re-run cascade to regenerate tomorrow's props with corrected weights

