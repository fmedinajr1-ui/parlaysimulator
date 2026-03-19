

# Fix: Missing `homeCourtMap` Declaration Crashing Parlay Generator

## Problem
The pipeline triggered successfully but `bot-generate-daily-parlays` crashed with:
```
ReferenceError: homeCourtMap is not defined
```

The variable `homeCourtMap` is used 62 times in the file but its declaration (`const homeCourtMap = new Map<string, HomeCourtData>()`) was accidentally removed in a recent edit. This prevents ALL parlay generation.

## Fix (1 line)

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

Add the missing declaration at line 4637 (before the `homeCourtResult.data` forEach that populates it):

```typescript
const homeCourtMap = new Map<string, HomeCourtData>();
```

## After Fix
- Redeploy `bot-generate-daily-parlays`
- Re-trigger `refresh-l10-and-rebuild` to generate today's parlays
- Verify parlays appear in `bot_daily_parlays` for today with the reverted (looser) filters

