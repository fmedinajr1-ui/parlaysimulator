

# Disable Golden Category Gate and Regenerate Parlays

## What Changed

The golden category enforcement we just added is skipping ~9 execution-tier parlays that don't meet the 50% golden-leg threshold. You want those parlays back -- so we'll disable the gate for now.

## Changes

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

### 1. Comment out the golden-leg enforcement block (lines 1659-1667)

Wrap the entire golden category check in a feature flag set to `false`, so the logic is preserved but inactive:

```typescript
// Golden category gate — disabled for now
const ENFORCE_GOLDEN_GATE = false;
if (ENFORCE_GOLDEN_GATE && tier === 'execution' && goldenCategories.size > 0) {
  ...
}
```

The weight-based sorting (Change 1 from last edit) will remain active so golden categories still get slight priority in ordering, but no parlays will be rejected.

### 2. Redeploy and trigger generation

After deploying, we'll call the edge function to regenerate today's parlays so all execution-tier parlays come through without being filtered.

## Impact

- All parlays that were previously skipped will now be generated
- Golden categories still sort higher (soft preference), but nothing gets blocked
- Easy to re-enable later by flipping `ENFORCE_GOLDEN_GATE` to `true`

