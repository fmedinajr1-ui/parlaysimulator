

## Block Steals, Blocks, and Losing Patterns from All Parlays

### Problems Found

**1. Normalized prop types bypass the block filter**

`isPropTypeBlocked()` checks for `player_steals` and `player_blocks`, but after normalization (which now runs everywhere), the prop type becomes `steals` or `blocks` -- which is NOT in the blocked set. This means steals/blocks picks that arrive already normalized slip right through.

**2. Mispriced picks skip the block filter entirely**

Sweet spot picks go through `isPropTypeBlocked()` twice (primary and fallback), but mispriced picks are never filtered for blocked prop types at all. A `player_steals` mispriced line can enter the parlay pool unchecked.

**3. Mega parlay scanner has no prop type filtering**

`nba-mega-parlay-scanner` explicitly requests `player_blocks` and `player_steals` from the odds API and stores them in the database with zero filtering. These then feed into the daily generation pipeline.

**4. Force-fresh parlays only check prefixed names**

`bot-force-fresh-parlays` blocks `player_steals` and `player_blocks` but not `steals` or `blocks` (the normalized forms).

**5. Losing players get a penalty but are never hard-blocked**

Players with hit rate below 30% (over 5+ legs) receive a -20 composite score penalty, but if their base score is high enough (e.g., double-confirmed with a big edge), they can still enter parlays. Serial losers should be hard-blocked.

### Fix Plan

**File 1: `supabase/functions/bot-generate-daily-parlays/index.ts`**

- **Expand `STATIC_BLOCKED_PROP_TYPES`** (~line 432) to include both prefixed and normalized forms:
  ```
  'player_steals', 'player_blocks', 'steals', 'blocks'
  ```
- **Add `isPropTypeBlocked` filter to mispriced picks** (~line 4562): After the mispriced enrichment map step, filter out any picks with blocked prop types before they enter the parlay pool.
- **Hard-block losing players** (~line 494 in `getPlayerBonus`): When a player has 5+ legs and hit rate below 30%, return a special sentinel value (e.g., -999) that the caller uses to skip the pick entirely, instead of just applying a -20 penalty that can be overcome.

**File 2: `supabase/functions/bot-force-fresh-parlays/index.ts`**

- **Expand the blocked set** (~line 125) to include normalized forms:
  ```
  'player_steals', 'player_blocks', 'steals', 'blocks'
  ```

**File 3: `supabase/functions/nba-mega-parlay-scanner/index.ts`**

- **Remove `player_blocks` and `player_steals`** from the API markets request string (~line 80) so they are never fetched or stored.

**File 4: Redeploy all three functions.**

### Technical Details

The `isPropTypeBlocked` fix is the most critical -- it is a single point of failure. By adding `steals` and `blocks` to the set, every call site (sweet spots primary, sweet spots fallback, and the new mispriced filter) automatically picks them up.

The mispriced filter insertion will follow the same pattern as the existing sweet spot filter:
```typescript
enrichedMispricedPicks = enrichedMispricedPicks.filter(pick => {
  const propType = (pick.prop_type || '').toLowerCase();
  const normProp = PROP_TYPE_NORMALIZE[propType] || propType;
  if (isPropTypeBlocked(propType) || isPropTypeBlocked(normProp)) {
    console.log(`[BlockedPropType] Filtered mispriced ${propType} for ${pick.player_name}`);
    return false;
  }
  return true;
});
```

The losing player hard-block will work by returning -999 from `getPlayerBonus` and adding a filter:
```typescript
// In getPlayerBonus:
if (perf.hitRate < 0.30) return -999; // hard-block signal

// At pick enrichment:
if (getPlayerBonus(name, prop) <= -999) {
  // skip pick entirely
}
```

### Impact

- Zero steals/blocks props in any parlay tier, regardless of which engine or naming convention produced them
- Zero mispriced steals/blocks slipping through the unfiltered path
- Zero mega-scanner steals/blocks entering the database
- Serial losing players (below 30% hit rate over 5+ legs) are fully excluded rather than just penalized
- All three functions redeployed with tightened filters

