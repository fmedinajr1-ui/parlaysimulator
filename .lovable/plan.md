
# Fix Telegram Not Showing Parlay Counts

## Root Cause

The Telegram notification is actually being sent (logs confirm it), but the **tier counts display as 0** because of a data format mismatch.

The generator sends:
```
data: {
  totalCount: 10,
  tierSummary: { execution: { count: 10, legDistribution: {...} } },
  poolSize: 150,
  date: '2026-02-11'
}
```

But `formatTieredParlaysGenerated()` expects:
```
{ totalCount, exploration, validation, execution, poolSize }
```

It destructures `exploration`, `validation`, `execution` directly from `data` -- but those fields don't exist at the top level. They're nested inside `tierSummary`. So the message reads "0 parlays" for every tier.

## Fix

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts` (lines 1987-1995)

Flatten the tier counts into the Telegram payload so `formatTieredParlaysGenerated` can read them:

```typescript
body: JSON.stringify({
  type: 'tiered_parlays_generated',
  data: {
    totalCount: allParlays.length,
    exploration: results['exploration']?.count || 0,
    validation: results['validation']?.count || 0,
    execution: results['execution']?.count || 0,
    poolSize: pool.totalPool,
    date: targetDate,
  },
}),
```

No changes needed to `bot-send-telegram/index.ts` -- the formatter already handles this shape correctly.

## Impact

- Telegram messages will now correctly show per-tier parlay counts (e.g., "Exploration: 19, Validation: 11, Execution: 10")
- The `totalCount` already works and will continue to
- Single-tier calls will show 0 for the other tiers (accurate)
- One-line change, redeploy automatically
