

## Fix: Enforce Strict Cap of 1 Per Player+Prop+Side (No Double-Confirmed Exception)

### Root Cause
The generator at line 3443 has:
```
const PLAYER_CAP = isDoubleConfirmed ? 2 : 1;
```
This lets "double-confirmed" picks (multi-engine agreement) appear in **2 parlays** instead of 1. Since most top picks are double-confirmed (VJ Edgecombe, Nickeil Alexander-Walker, etc.), they bypass the cap. Running the generator twice compounds this to 4+ appearances.

### Fix

**File: `supabase/functions/bot-generate-daily-parlays/index.ts`**

1. **Remove the double-confirmed exception** — change line 3443 to always use cap of 1:
   - Remove lines 3439-3443 (the `isDoubleConfirmed` logic and variable `PLAYER_CAP`)
   - Replace with: `const currentUsage = globalSlatePlayerPropUsage.get(playerPropSideKey) || 0; if (currentUsage >= 1) return false;`

**File: `supabase/functions/bot-daily-diversity-rebalance/index.ts`**

2. No code change needed — the rebalance logic is correct with `maxPlayerPropUsage = 1`. It will serve as a safety net.

### After Deploy
- Run the rebalance once to clean up today's existing duplicates
- Verify no player+prop+side appears more than once in pending parlays

