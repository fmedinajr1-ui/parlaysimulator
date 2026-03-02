

# Fix: `defenseDetailMap is not defined` Runtime Error

## Problem
The function `calculateTeamCompositeScore` (line 1919) references `defenseDetailMap` at line 2020, but this variable is NOT passed as a parameter. It only exists inside the `serve()` handler scope (created at line 4063). Since the function is defined outside that scope, it throws `ReferenceError: defenseDetailMap is not defined` at runtime when scoring team total bets.

This crash prevents the quality regen loop from generating any parlays, which is why the system falls back to `bot-force-fresh-parlays` and produces 0 Sweet Spot core parlays.

## Fix

### Step 1: Add `defenseDetailMap` parameter to `calculateTeamCompositeScore`

Add a new parameter `defenseDetailMap` (type `Map<string, any>`) to the function signature at line 1919, after the existing `defenseMap` parameter.

### Step 2: Update all 7 call sites to pass `defenseDetailMap`

There are 7 places where `calculateTeamCompositeScore` is called (lines 4650, 4664, 4680, 4750, 4794, 4808, and possibly the WNBA routing). Each call needs `defenseDetailMap` added as an argument. All call sites are inside `buildCandidatePool()` where `defenseDetailMap` is already in scope.

### Step 3: Deploy the fixed function

Deploy `bot-generate-daily-parlays` so the fix takes effect.

### Step 4: Re-trigger generation pipeline

Invoke the quality regen loop and generation pipeline to produce today's Sweet Spot core parlays now that the crash is fixed.

## Technical Details

**Root cause:** `defenseDetailMap` is a local variable inside `buildCandidatePool()` (line 4063). The function `calculateTeamCompositeScore` is declared at module scope (line 1919) so it cannot access that variable without it being passed as a parameter.

**Affected code path:** Only NBA/WNBA team total bets hit the `defenseDetailMap.get()` call at line 2020. Spread and moneyline bets use `defenseMap` (which IS passed correctly), so those work fine.

**Files modified:** 1 edge function
- `supabase/functions/bot-generate-daily-parlays/index.ts` -- add parameter + update call sites

**Post-fix:** Re-run `bot-quality-regen-loop` and verify parlays generate successfully.

