

# Strict Prop Overlap Prevention Across All Bot Functions

## Problem

The `parlayVetoUtils.ts` file defines combo overlap rules (e.g., points + PRA = correlated, blocks for same player twice), but **no edge function imports or enforces these rules**. The three parlay-building functions each have partial checks:

- **bot-generate-daily-parlays**: Tracks `playerUsageCount` across parlays but does NOT check for same-player-within-a-parlay or combo stat overlap (points + PRA)
- **bot-force-fresh-parlays**: Checks `usedPlayers` within a parlay (good), but no combo overlap check
- **nba-mega-parlay-scanner**: Checks `usedPlayers` (good), but no combo overlap check

None of them prevent correlated props like "LeBron points OVER + LeBron PRA OVER" in the same parlay.

## Solution: Inline Veto Function in All 3 Bot Functions

Since edge functions can't import from `src/utils/`, we'll add an inline `isCorrelatedProp()` function to each bot. This function enforces:

1. **No same player twice** in a single parlay (already partially done, but tightened)
2. **No base + combo overlap**: points + PRA, rebounds + PR, assists + RA, etc. for the same player
3. **No combo stacking**: PRA + PR for the same player

### The shared inline function (added to all 3 files):

```typescript
const COMBO_BASES: Record<string, string[]> = {
  pra: ['points', 'rebounds', 'assists'],
  pr: ['points', 'rebounds'],
  pa: ['points', 'assists'],
  ra: ['rebounds', 'assists'],
};

function hasCorrelatedProp(
  existingLegs: Array<{ player_name: string; prop_type: string }>,
  candidatePlayer: string,
  candidateProp: string
): boolean {
  const player = candidatePlayer.toLowerCase().trim();
  const prop = normalizePropType(candidateProp);
  
  const playerLegs = existingLegs
    .filter(l => l.player_name.toLowerCase().trim() === player)
    .map(l => normalizePropType(l.prop_type));
  
  if (playerLegs.length === 0) return false;
  
  // Rule 1: Same player already in parlay = always correlated
  // (catches exact duplicates AND any multi-prop same-player)
  
  // Rule 2: Combo + base overlap
  const combos = Object.keys(COMBO_BASES);
  if (combos.includes(prop)) {
    const bases = COMBO_BASES[prop];
    if (playerLegs.some(s => bases.includes(s))) return true;
    if (playerLegs.some(s => combos.includes(s))) return true;
  }
  for (const existing of playerLegs) {
    if (combos.includes(existing)) {
      const bases = COMBO_BASES[existing];
      if (bases?.includes(prop)) return true;
    }
  }
  
  return true; // Same player = always block (one player per parlay)
}
```

### File 1: `bot-generate-daily-parlays/index.ts`

Add the `hasCorrelatedProp` function and integrate it into `canUsePickInParlay()`. Before the `return true` at line 3008, add:

```typescript
// STRICT: No correlated props for same player in parlay
if ('player_name' in pick && existingLegs && existingLegs.length > 0) {
  const playerLegsInParlay = existingLegs
    .filter(l => l.player_name)
    .map(l => ({ player_name: l.player_name, prop_type: l.prop_type || l.bet_type || '' }));
  if (hasCorrelatedProp(playerLegsInParlay, pick.player_name, pick.prop_type)) return false;
}
```

### File 2: `bot-force-fresh-parlays/index.ts`

Add the `hasCorrelatedProp` function. In the parlay-building loop (line 231), replace the simple `usedPlayers.has(playerKey)` check with:

```typescript
// Rule 1: No correlated props (same player OR base+combo overlap)
const parlayLegsForCheck = parlay.map(p => ({ player_name: p.player_name, prop_type: p.prop_type }));
if (hasCorrelatedProp(parlayLegsForCheck, pick.player_name, pick.prop_type)) continue;
```

### File 3: `nba-mega-parlay-scanner/index.ts`

Add the `hasCorrelatedProp` function. In the parlay-building loop (line 574-580), replace the `usedPlayers.has(nameKey)` check with:

```typescript
// No correlated props (same player OR base+combo overlap)
const existingForCheck = parlayLegs.map(p => ({ player_name: p.player_name, prop_type: p.prop_type }));
if (hasCorrelatedProp(existingForCheck, prop.player_name, prop.prop_type)) continue;
```

Same for the relaxed fallback loop (line 588).

## Files Modified

1. `supabase/functions/bot-generate-daily-parlays/index.ts` -- Add `hasCorrelatedProp` + integrate into `canUsePickInParlay`
2. `supabase/functions/bot-force-fresh-parlays/index.ts` -- Add `hasCorrelatedProp` + replace simple player check
3. `supabase/functions/nba-mega-parlay-scanner/index.ts` -- Add `hasCorrelatedProp` + replace simple player check in both loops

## Impact

After this change, no parlay from any bot will ever contain:
- Same player twice (any prop combination)
- Points + PRA, Rebounds + PR, Assists + RA, or any base+combo pair for the same player
- Two combo stats (PRA + PR) for the same player

