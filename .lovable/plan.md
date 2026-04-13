

# Kill Spread Snapback Signals

## Problem
Spread snapback (Take It Now) signals are hitting at 44% overall — below breakeven across all spread size ranges. No subset is profitable enough to keep.

## Change

**File**: `supabase/functions/fanduel-prediction-alerts/index.ts`

Add a kill gate for spread snapback signals right after the existing favorites-only ML gate (line 946). This blocks all spread-type Take It Now signals:

```typescript
// Kill gate: spread snapbacks historically ≤50% across all ranges
if (isTeamMarket && last.prop_type === 'spreads') {
  log(`🚫 KILLED TIN spread: ${last.player_name} (${last.line}) — below breakeven`);
  continue;
}
```

## After Deploy
Re-invoke the function to regenerate today's signals without spread snapbacks.

