

# Apply Flip Logic Pipeline-Wide (With Smart Exceptions) + Admin Sweet Spots

## Key Insight: Not a Blanket Block Everywhere

The Sharp Parlay Builder and Heat Prop Engine already have **per-player category-side enforcement** from sweet spots. This is smarter than a blanket flip -- if a specific player's rebounds-over is hitting at 80% L10, the sweet spot says "over" and it passes through. A blanket block would kill good picks.

So the approach is **tiered**:
- Engines WITH sweet-spot intelligence: keep the smart per-player filter, no blanket flip needed
- Engines WITHOUT sweet-spot intelligence: add the blanket flip map as a safety net

## Which Engines Get What

| Engine | Has Sweet Spot Enforcement? | Action |
|--------|---------------------------|--------|
| `sharp-parlay-builder` | YES (category-side enforcement, line 849-870) | No blanket flip -- sweet spots already handle it per-player |
| `heat-prop-engine` | YES (category-side enforcement, line 1007+) | No blanket flip -- sweet spots already handle it per-player |
| `bot-generate-daily-parlays` | YES but flip only on `cash_lock` | Expand flip to ALL strategies |
| `nba-mega-parlay-scanner` | NO | Add POISON_FLIP_MAP |
| `bot-force-fresh-parlays` | YES (just added) | Already done |

## Changes

### File 1: `supabase/functions/bot-generate-daily-parlays/index.ts`

**Expand CASH_LOCK_FLIP_MAP to apply globally** (line 3031-3041)

Remove the `if (strategyName && strategyName.includes('cash_lock'))` condition so the flip map applies to ALL strategies built through the main engine, not just cash_lock. The map already only contains categories with proven 0% hit rates on one side, so it's safe globally.

Change:
```text
if (strategyName && strategyName.includes('cash_lock')) {
```
To:
```text
if (strategyName) {  // Apply flip map to ALL strategies
```

This means rebounds-over and threes-over still get blocked in the main engine's category-level builds, but...

### File 2: `supabase/functions/sharp-parlay-builder/index.ts` -- NO CHANGE

This engine already has per-player category-side enforcement (lines 849-870). If a player's sweet spot says rebounds-over is hitting, it passes. If it says under, it blocks. This is the most efficient engine for allowing threes-over and rebounds-over when the data supports it for a specific player.

### File 3: `supabase/functions/heat-prop-engine/index.ts` -- NO CHANGE

Same as Sharp Builder -- already has per-player category-side enforcement (lines 1007+). Rebounds-over and threes-over pass through when a player's sweet spot data confirms they're hitting.

### File 4: `supabase/functions/nba-mega-parlay-scanner/index.ts`

**Add POISON_FLIP_MAP** (after normalizePropType, around line 36):

```text
const POISON_FLIP_MAP: Record<string, 'over' | 'under'> = {
  'rebounds': 'under',
  'threes': 'under',
  'three_pointers': 'under',
  'steals': 'under',
};
```

**Apply in scoring loop** (around line 596, inside the `for (const prop of uniqueProps)` loop):

```text
const normPropFlip = normalizePropType(prop.prop_type);
const forcedSide = POISON_FLIP_MAP[normPropFlip];
if (forcedSide && prop.side?.toLowerCase() !== forcedSide) {
  continue;
}
```

The lottery scanner has no sweet spot enforcement, so the blanket flip is needed here.

### File 5: `supabase/functions/telegram-webhook/index.ts`

**Add `/sweetspots` admin command** that shows today's active sweet spot picks:

1. Query `category_sweet_spots` where `analysis_date = today` and `is_active = true`
2. Cross-reference with `unified_props` to show only picks with active lines
3. Format output: player, prop type, side, line, L10 hit rate, confidence
4. Register in admin command routing and help text

## Summary

- Sharp Builder and Heat Engine: threes-over and rebounds-over CAN still pass when per-player sweet spot data confirms they're hitting (the most efficient path)
- Main Engine, Mega Scanner, Force Fresh: blanket flip blocks poison sides where no per-player intelligence exists
- New `/sweetspots` Telegram command gives admin visibility into active sweet spot picks with live lines

## Deployment

Deploy 3 updated edge functions: `bot-generate-daily-parlays`, `nba-mega-parlay-scanner`, `telegram-webhook`

