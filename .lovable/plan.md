

# Build 1-2 Mixed NCAAB Parlays (Spreads + Totals)

## What We're Doing
Adding a focused "mixed" NCAAB profile that combines the best spread pick (Iowa State -7.5) with top totals (Michigan O155.5, Vanderbilt O165.5) into 1-2 parlays -- replicating yesterday's winning pattern. No threshold lowering, no quality compromises.

## Changes

### 1. Add Mixed NCAAB Profiles to Generation Engine
**File:** `supabase/functions/bot-generate-daily-parlays/index.ts`

Add 2 new mixed spread+total profiles to the Exploration and Execution tiers:

**Exploration tier** (after line 90):
- `{ legs: 3, strategy: 'ncaab_mixed', sports: ['basketball_ncaab'], betTypes: ['spread', 'total'] }`

**Execution tier** (after line 205):
- `{ legs: 3, strategy: 'ncaab_mixed', sports: ['basketball_ncaab'], betTypes: ['spread', 'total'], minHitRate: 55, sortBy: 'composite' }`

These profiles allow the generator to pull from both the spread AND total pools for NCAAB, creating mixed parlays like "Iowa State -7.5 + Michigan O155.5 + Vanderbilt O165.5" -- exactly matching yesterday's winning formula.

### 2. Re-Run Generation
After deploying the updated function, trigger `bot-generate-daily-parlays` with `force_regenerate: true` to generate the new mixed NCAAB parlays alongside existing ones.

## What This Keeps Safe
- Composite score floor stays at 62 (no lowering)
- Spread cap (MAX_SPREAD_LINE = 10) remains enforced
- Only adds 2 profiles, no bloat to generation volume
- Targets the exact pattern that went 4-0 yesterday
