

## Root Cause: Why Parlays Look the Same

The new protocols ARE deployed and working — the role_stacked 5/8-leg tickets show 80-100% L10 hit rates, and the curated pipeline produced 3 tickets. However, the output is dominated by **two uncontrolled generators**:

| Generator | Pending | Has 80% Gate? | Problem |
|-----------|---------|---------------|---------|
| `force_mispriced_conviction` | 9 (33%) | No | Uses conviction scoring only, no L10 filter |
| `elite_categories_v1_execution_shootout_stack` | 3 | No | Cluster builder bypasses tier profile L10 gate |
| `role_stacked_5leg` | 3 (identical) | Yes (80%+) | Quality regen creates 3 duplicate copies |
| `role_stacked_8leg` | 3 (identical) | Yes (80%+) | Quality regen creates 3 duplicate copies |
| `curated_pipeline` | 3 | Yes (65%+) | Working correctly |
| Other | 6 | Mixed | Lottery/exploration |

### Three specific fixes needed:

### Fix 1: Add 80% L10 gate to `bot-force-fresh-parlays`
Currently at line ~260-320, picks are scored by conviction (edge + tier bonus + risk confirmation) but have **zero L10 hit rate filtering**. The function doesn't even load L10 hit rates for its picks.

**Change**: After loading mispriced lines (step 2), cross-reference each pick with `unified_props` or `category_sweet_spots` to get L10 hit rate, and filter out picks below 80%.

### Fix 2: Add 80% L10 gate to cluster parlay builder
In `bot-generate-daily-parlays`, lines 9038-9143, the environment cluster builder (SHOOTOUT/GRIND) selects picks by composite score and anti-correlation but **bypasses the L10 gate** that exists in `generateTierParlays`. The `hit_rate` field on these legs shows 0.67-0.74 (67-74%) — below the 80% threshold.

**Change**: Add `l10HrPct < 80 → continue` check inside the cluster builder loop (around line 9070).

### Fix 3: Deduplicate quality regen outputs
`bot-quality-regen-loop` runs 3 attempts with `skip_void: true`, but each attempt produces identical parlays (same fingerprint). The deduplication in `bot-generate-daily-parlays` only blocks exact fingerprints from the same run — cross-run fingerprints from regen attempts still pass.

**Change**: In `bot-quality-regen-loop`, after all attempts, add a dedup pass that finds parlays with identical `legs` JSON across attempts and voids duplicates (keeping only the first occurrence).

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/bot-force-fresh-parlays/index.ts` | Add L10 hit rate lookup + 80% filter on all picks |
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add 80% L10 gate in cluster builder (~line 9070) |
| `supabase/functions/bot-quality-regen-loop/index.ts` | Add post-attempt dedup pass to void identical parlays |

