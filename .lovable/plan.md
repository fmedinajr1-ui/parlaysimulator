

## Fix: PropTypeCap Blocking Nearly All Legs on Single-Sport Nights

### Root Cause

Line 2113 in `bot-generate-daily-parlays/index.ts`:
```
const maxPropTypeLegs = Math.max(1, Math.floor(totalLegs * 0.4));
```

For a 3-leg parlay: `floor(3 * 0.4) = 1` -- only **1 leg** of any prop type is allowed per parlay.

Tonight's pool is almost entirely "points" props. After the first "points" leg is selected, every remaining "points" candidate is blocked by PropTypeCap, making it impossible to build a 2nd or 3rd leg. This is why profiles report "only 1/3 legs built from 54 candidates" and "only 0/3 legs built from 0 candidates".

### The Fix

Raise the PropTypeCap formula in Volume Mode so small-pool / single-sport nights can still build parlays from a points-heavy pool.

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Change 1 -- Relax PropTypeCap in Volume Mode** (line 2113):

Currently:
```typescript
const maxPropTypeLegs = Math.max(1, Math.floor(totalLegs * 0.4));
```

Change to:
```typescript
const maxPropTypeLegs = volumeMode 
  ? Math.max(2, Math.floor(totalLegs * 0.67))  // Volume mode: allow 2 of same type in 3-leg
  : Math.max(1, Math.floor(totalLegs * 0.4));   // Normal: keep existing 40% cap
```

For a 3-leg parlay in volume mode: `floor(3 * 0.67) = 2` -- allows 2 "points" legs + 1 different type, or all 3 from different types. This unblocks the vast majority of candidates tonight.

**Change 2 -- Pass volumeMode flag to the eligibility function**

The `isPickEligible` function (around line 2060) needs access to the `volumeMode` boolean. Add it as a parameter and thread it through from the caller.

**Change 3 -- Same fix for Monster PropTypeCap** (line 5425):

Apply the same relaxation to the monster parlay prop type cap:
```typescript
const maxPropLegs = volumeMode
  ? Math.max(3, Math.floor(maxLegs * 0.5))
  : Math.max(1, Math.floor(maxLegs * 0.4));
```

### Expected Impact

- Tonight's 54 "points"-heavy pool will now allow 2 points legs per 3-leg parlay
- Each run should produce 8-15 parlays instead of 0-2
- Normal multi-sport nights (large diverse pools) keep the strict 40% cap for variety
- No database changes needed -- single file modification

