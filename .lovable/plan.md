

# Flip Totals Snapback Direction: UNDER → OVER

## Problem
NHL game totals snapbacks went 0/5 on April 11 — all were "under" predictions. The current logic follows market direction (line dropping → UNDER), but totals appear to perform better when faded (contrarian).

## Change

**File**: `supabase/functions/fanduel-prediction-alerts/index.ts`

After the spread kill gate (line 952), add a direction flip for totals snapbacks:

```typescript
// Flip totals snapbacks: unders historically 0% — contrarian OVER
if (isTeamMarket && last.prop_type === 'totals' && snapDirection === 'UNDER') {
  snapDirection = 'OVER';
  directionReason = `Contrarian flip: totals unders historically 0% — taking OVER`;
  log(`🔄 FLIPPED TIN totals to OVER: ${last.player_name} (${last.line})`);
}
```

This flips any totals snapback that would have been UNDER to OVER instead, while keeping OVER predictions unchanged.

## After Deploy
Re-invoke the function to regenerate today's signals with the flipped direction.

