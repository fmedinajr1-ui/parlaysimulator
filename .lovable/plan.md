

# Fix: `thinSlateOverride` Scoping Bug Blocking Bot Generation

## Problem

The bot generation pipeline is currently **completely broken** with this error:
```
ReferenceError: thinSlateOverride is not defined
```

Inside the `generateTierParlays` function (line 2811), two variables from the outer handler scope are referenced but not accessible:
- `thinSlateOverride` — should be the function parameter `isThinSlate`
- `maxLegsOverride` — not passed as a parameter at all

This is a pre-existing scoping bug unrelated to the ML fix, but it blocks all generation.

## The Fix (1 file, 1 change)

### File: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Line 2811**: Replace the outer-scope variables with the function's own parameter:

```typescript
// BEFORE (broken):
const effectiveMaxLegs = (thinSlateOverride && maxLegsOverride) 
  ? Math.min(profile.legs, maxLegsOverride) 
  : profile.legs;

// AFTER (fixed):
const effectiveMaxLegs = isThinSlate 
  ? Math.min(profile.legs, 3) 
  : profile.legs;
```

- `thinSlateOverride` becomes `isThinSlate` (the existing function parameter, already passed correctly at the call site on line 3300)
- `maxLegsOverride` becomes a hardcoded `3` (matching the default value set on line 2858 and the thin-slate intent)

After this fix, the function will be redeployed and we can re-run generation to verify the NCAAB ML_FAVORITE block.
