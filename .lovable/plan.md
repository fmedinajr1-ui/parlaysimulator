

# Flip Losing Categories Instead of Blocking + Recalibrate Winners

## Strategy

Instead of blocking underperforming categories (which wastes data), we **flip the bet direction**. If "VOLUME_SCORER over" keeps missing at a -17 streak, the under side is likely hitting. Same logic for ROLE_PLAYER_REB, BIG_ASSIST_OVER, and ELITE_REB_OVER.

## Weight Changes

### Flip to opposite side (not block)
| Category | Old Side | Old Weight | New Side | New Weight | Reasoning |
|---|---|---|---|---|---|
| VOLUME_SCORER | over | 1.125 | **under** | **1.10** | -17 streak on over = under is hitting |
| ROLE_PLAYER_REB | over | 1.128 | **under** | **1.10** | -16 streak on over |
| BIG_ASSIST_OVER | over | 1.143 | **under** | **1.05** | -9 streak on over |
| ELITE_REB_OVER | over | 0.76 | **under** | **1.00** | 20% hit rate on over, small sample |

The original "over" entries get blocked (weight 0) so they stop generating, and new "under" entries are created with moderate weights to let them prove themselves.

### Boost winning categories
| Category | Side | Old Weight | New Weight |
|---|---|---|---|
| STAR_FLOOR_OVER | over | 1.06 | **1.30** |
| MID_SCORER_UNDER | under | 1.05 | **1.25** |
| ASSIST_ANCHOR | under | 1.11 | **1.25** |

### Cautious unblock
| Category | Side | Action |
|---|---|---|
| HIGH_ASSIST | over | Unblock with weight **0.90** (62.5% yesterday) |

## Technical Implementation

### 1. Database updates to `bot_category_weights`

**Block the losing "over" sides** (4 UPDATE statements):
- Set `weight = 0`, `is_blocked = true`, `block_reason = 'Flipped to under side'` for VOLUME_SCORER/over, ROLE_PLAYER_REB/over, BIG_ASSIST_OVER/over, ELITE_REB_OVER/over

**Insert new "under" counterparts** (4 INSERT statements):
- Create VOLUME_SCORER/under (weight 1.10), ROLE_PLAYER_REB/under (weight 1.10), BIG_ASSIST_OVER/under (weight 1.05), ELITE_REB_OVER/under (weight 1.00)
- Initial streak = 0, total_picks = 0 (fresh start for the flipped side)

**Boost winners** (3 UPDATE statements):
- STAR_FLOOR_OVER weight -> 1.30
- MID_SCORER_UNDER weight -> 1.25
- ASSIST_ANCHOR/under weight -> 1.25

**Unblock HIGH_ASSIST** (1 UPDATE):
- Set `is_blocked = false`, `weight = 0.90`

### 2. Update the generator to be side-aware

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

The `weightMap` currently keys by category only (`weightMap.set(w.category, w.weight)`). This means both VOLUME_SCORER/over and VOLUME_SCORER/under would share the same weight — defeating the flip.

Fix: Make the weightMap key include the side:
```typescript
// Before
weightMap.set(w.category, w.weight);

// After  
weightMap.set(`${w.category}__${w.side}`, w.weight);
// Also keep category-only key as fallback
if (!weightMap.has(w.category)) {
  weightMap.set(w.category, w.weight);
}
```

Then update all `weightMap.get(category)` lookups to first try `weightMap.get(`${category}__${side}`)` before falling back to `weightMap.get(category)`.

This affects ~5 lookup sites in the generator.

### 3. Update `category-props-analyzer` to support flipped sides

The analyzer needs to know that when a category weight exists for the "under" side, it should recommend "under" instead of the default "over". Check the `recommended_side` logic in the analyzer and ensure flipped categories produce picks with the correct side.

### 4. Trigger recalibration and regeneration

- Call `calibrate-bot-weights` to sync the new weights
- Call `bot-generate-daily-parlays` to regenerate today's (Feb 12) parlays with the flipped categories

## What Changes for Today's Parlays

- Categories that were bleeding money on "over" will now generate "under" picks instead
- Winners (STAR_FLOOR, MID_SCORER_UNDER, ASSIST_ANCHOR) get priority with boosted weights
- The system learns both directions independently -- if the flip works, the weight grows; if not, it gets blocked too
- No data is wasted by blocking -- we extract value from the pattern in both directions
