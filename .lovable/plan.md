

# Add Prop Type Diversity Enforcement to Lottery Scanner

## Problem
The lottery scanner can stack multiple legs of the same prop type (e.g., 3-4 threes legs), reducing diversity and increasing correlation risk.

## Solution
Add a single guard in `passesBasicChecks` to cap any normalized prop type at 2 legs max per parlay.

## Changes

### File: `supabase/functions/nba-mega-parlay-scanner/index.ts`

**1. Add constant (line 596, after `MAX_PER_GAME`):**
```typescript
const MAX_SAME_PROP = 2;
```

**2. Add check in `passesBasicChecks` (before `return true` at line 611):**
```typescript
const propNorm = normalizePropType(prop.prop_type);
const sameTypeCount = existingLegs.filter(l => normalizePropType(l.prop_type) === propNorm).length;
if (sameTypeCount >= MAX_SAME_PROP) return false;
```

This single change covers all build paths -- role-based (safe/balanced/great_odds), replay mode, relaxed fallbacks, and greedy fill -- since they all call `passesBasicChecks`.

## Result
- Any 3-leg parlay must have at least 2 different prop categories
- No prop type (threes, points, rebounds, etc.) can appear more than twice
- Zero risk of 4x threes stacking

