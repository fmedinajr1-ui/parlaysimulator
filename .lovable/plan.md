
# Add 50% Void Threshold to Settlement Logic

## What Changes

In `supabase/functions/bot-settle-and-learn/index.ts`, lines 264-282, add a check: if more than 50% of a parlay's legs are voided, mark the entire parlay as `void` regardless of the remaining legs' outcomes.

## Current Logic
```text
if activeLegCount === 0 --> void
else if all active legs graded --> won or lost
```

## New Logic
```text
if activeLegCount === 0 --> void
else if legsVoided > legs.length / 2 --> void (too many DNPs)
else if all active legs graded --> won or lost
```

## Technical Details

### File: `supabase/functions/bot-settle-and-learn/index.ts`
**Lines 264-267**: Expand the void condition to include the 50% threshold:

```typescript
if (activeLegCount === 0 || legsVoided > legs.length / 2) {
  // All or majority of legs voided — void entire parlay
  outcome = 'void';
  parlaysSettled++;
}
```

This is a one-line change -- adding `|| legsVoided > legs.length / 2` to the existing void check. Everything else stays the same.
