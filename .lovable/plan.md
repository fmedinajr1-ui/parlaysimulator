

# Fix force_mispriced_conviction: Apply Flip Logic to Poison Legs

## The Problem

`force_mispriced_conviction` has a 21.5% hit rate across 184 parlays -- consistently losing money. This strategy runs through `bot-force-fresh-parlays/index.ts`, which is a **separate function** from the main parlay engine. It builds 3-leg parlays from ELITE/HIGH mispriced lines but has **zero flip logic** -- the same poison categories (REBOUNDS over, THREES over, etc.) that killed `cash_lock` are killing this strategy too.

## The Fix: Add Flip Map to bot-force-fresh-parlays

Rather than disabling the strategy entirely (it still has edge from mispriced detection), we'll apply the same proven flip logic from `cash_lock` to filter out poison-side legs.

**File:** `supabase/functions/bot-force-fresh-parlays/index.ts`

### Change 1: Add MISPRICED_FLIP_MAP constant (after line 32)

Add a flip map identical to the cash_lock version, plus add global blocked categories:

```text
const BLOCKED_CATEGORIES_FORCE = new Set([
  'VOLUME_SCORER',
  'ROLE_PLAYER_REB',
]);

const MISPRICED_FLIP_MAP: Record<string, 'over' | 'under'> = {
  'rebounds': 'under',
  'threes': 'under',
  'three_pointers': 'under',
  'player_rebounds': 'under',
  'player_threes': 'under',
  'player_three_pointers': 'under',
  'steals': 'under',
  'player_steals': 'under',
};
```

Since `force_mispriced_conviction` doesn't use category labels (it works directly with prop types from `mispriced_lines`), the flip map keys will be **prop type names** (normalized) rather than category names.

### Change 2: Apply flip filter during pick scoring (lines 244-296)

In the scoring loop where picks are built from mispriced lines, add a check: if the prop type is in `MISPRICED_FLIP_MAP` and the signal (side) doesn't match the forced direction, skip the pick entirely.

After the sweet spot conflict check (line 259), add:

```text
// === FLIP MAP GATE: skip poison-side legs ===
const normProp = normalizePropType(ml.prop_type);
const forcedSide = MISPRICED_FLIP_MAP[normProp];
if (forcedSide && ml.signal.toLowerCase() !== forcedSide) {
  console.log(`[ForceFresh] FLIP BLOCKED: ${ml.player_name} ${ml.prop_type} ${ml.signal} (forced: ${forcedSide})`);
  continue;
}
```

### Change 3: Block globally-terrible prop types

In the existing `filteredLines` filter (line 221-235), add a check against the normalized prop type for blocked categories. Since this function doesn't have category labels, we'll block by prop type pattern:

```text
// Block prop types tied to 0% hit rate categories
const normPropCheck = normalizePropType(propType);
if (normPropCheck === 'double_double' || normPropCheck === 'triple_double') {
  // These are exotic props with very low base rates -- keep only if risk-confirmed
}
```

This is lighter since `VOLUME_SCORER` and `ROLE_PLAYER_REB` are category labels from the main engine that don't exist in this function. The prop-type-level flip map covers the same ground.

## Summary of Changes

| # | What | Where | Effect |
|---|------|-------|--------|
| 1 | Add `MISPRICED_FLIP_MAP` constant | After line 32 | Maps poison prop types to forced winning side |
| 2 | Apply flip gate in pick scoring | After line 259 | Skips picks where signal conflicts with forced side |
| 3 | Add logging | Same location | Tracks how many picks get flipped out for monitoring |

## Expected Result

- Rebounds-over, threes-over, and steals-over legs get filtered out of `force_mispriced_conviction` parlays
- Only legs on historically-winning sides survive into the 3-leg builds
- The 21.5% hit rate should improve significantly as the poison legs are removed
- No need to disable the strategy -- the edge detection is sound, just the side selection was wrong on specific prop types

