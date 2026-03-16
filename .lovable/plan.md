

# Why Parlays Keep Getting Voided & Composite Filter Never Runs

## Root Cause

The `bot-generate-daily-parlays` edge function **times out before completing**. Here's the execution flow:

1. Exploration tier starts with 150 target × 90+ profiles × 2000 iterations = massive combinatorial work
2. Edge function hard limit is ~150 seconds
3. The function hits the wall-clock limit during exploration tier
4. **Validation tier, execution tier, dedup, composite filter, and DB insert all get skipped**

The 10 parlays you see were created by the `bot-quality-regen-loop` calling the generator with `source: quality_regen_attempt_1`, which does a single-attempt generation. Of those 10, 3 were voided by exposure caps (players in 3+ parlays) and 6 others were voided by the L10-fresh rebuild void-all step.

The composite filter code is correct. The Telegram handler for `composite_conflict_report` is correct. They simply never execute because the function dies before reaching them.

## Plan

### 1. Reduce exploration tier volume to prevent timeout

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

In `TIER_CONFIG.exploration`:
- Reduce `count` from 150 → 50 (on thin slates, we don't need 150 exploration parlays)
- Reduce `iterations` from 2000 → 800

Add thin-slate override near line 10126:
```
if (isThinPool || isThinSlate) {
  TIER_CONFIG.exploration.count = Math.min(TIER_CONFIG.exploration.count, 30);
  TIER_CONFIG.exploration.iterations = 800;
  TIER_CONFIG.validation.count = Math.min(TIER_CONFIG.validation.count, 15);
  TIER_CONFIG.execution.count = Math.min(TIER_CONFIG.execution.count, 15);
  console.log(`[Bot v2] Thin slate: reduced tier targets (exp=30, val=15, exec=15)`);
}
```

This ensures all 3 tiers complete within the timeout, and the composite filter + insert actually execute.

### 2. Add timeout-aware tier progression

After each tier completes in the `for (const tier of tiersToGenerate)` loop (line 10259), add a time check:
```
const totalElapsed = Date.now() - functionStartTime;
if (totalElapsed > 120_000) {
  console.log(`[Bot v2] ⏰ Global timeout approaching (${totalElapsed}ms), skipping remaining tiers`);
  break;
}
```

This provides a safety net so the function at least saves what it has rather than dying silently.

### 3. Ensure composite filter runs even on partial results

Move the composite filter and DB insert into a `finally`-like block or ensure they execute even if only exploration tier completed. Currently the flow is sequential — if the function hard-crashes, nothing gets saved.

### Summary of Changes

| File | Change |
|------|--------|
| `bot-generate-daily-parlays/index.ts` | Reduce thin-slate tier targets so all 3 tiers + composite filter fit within 150s |
| `bot-generate-daily-parlays/index.ts` | Add global timeout guard in tier loop |
| `bot-generate-daily-parlays/index.ts` | Log when tiers are skipped due to timeout |

### Expected Outcome
- All 3 tiers will complete on thin slates
- Composite filter will execute and log `[CompositeFilter]` lines
- Composite conflict report will be sent to Telegram
- More parlays survive because execution tier actually runs

