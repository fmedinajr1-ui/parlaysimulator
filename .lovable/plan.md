

# Why No Floor/Ceiling Parlays Were Generated

## Root Cause
The pipeline filters sweet spots down to only picks with **verified sportsbook lines** (`has_real_line` check at line 4525). Today, only **11 sweet spots** survived this filter. Most players with strong L10 floor data (LaMelo Ball, Donovan Clingan, James Harden, etc.) had `actual_line: null` and no match in the unified_props odds map, so they were eliminated before the floor/ceiling logic ever ran.

With only 11 picks in the pool, the strict floor_lock gate (`l10_min >= line`) and ceiling_shot gate (`l10_max >= line * 1.3`) likely couldn't find 3 qualifying legs each.

## Fix: Two Changes

### 1. Relax the verified-line requirement for floor/ceiling strategies
For `floor_lock` and `ceiling_shot` profiles only, allow picks that have L10 data even if they don't have a live sportsbook line — use `recommended_line` as fallback. The L10 data IS the verification for these strategies.

In the enrichment filter (~line 4520-4527), keep all picks with `l10_min != null` or `l10_max != null` regardless of `has_real_line`. Then in the floor/ceiling candidate filtering (~line 6860), use `p.actual_line || p.recommended_line` as the comparison line.

### 2. Add diagnostic logging
Add a log line before the floor/ceiling filtering that prints how many sweet spots have L10 data, so we can see exactly what's available:
```
[Bot] floor_lock pool: X picks with l10_min, Y pass floor gate (need 3)
[Bot] ceiling_shot pool: X picks with l10_max, Y pass ceiling gate (need 3)
```

### Files Changed
1. **`supabase/functions/bot-generate-daily-parlays/index.ts`**:
   - In the enrichment filter (~4520): preserve picks with L10 data even without verified lines
   - In floor_lock filtering (~6860): add diagnostic logging
   - In ceiling_shot filtering (~6900): add diagnostic logging

