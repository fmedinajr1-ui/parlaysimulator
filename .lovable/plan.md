

## Cross-Reference: Mispriced Lines x Risk Engine Picks

### The Problem

The `mispriced_lines` table uses prop types like `player_points`, `player_assists`, `player_rebounds` while `nba_risk_engine_picks` uses short names like `points`. This naming mismatch means a simple SQL join finds zero overlaps. We need a normalization layer to match them, plus a new UI component to surface the highest-conviction plays where both engines agree.

### What We'll Build

A new **"High Conviction Plays"** card that automatically cross-references mispriced lines against all 4 engines (Risk Engine, Prop V2, Sharp Builder, Heat Engine) and highlights overlaps where the statistical edge from mispriced lines is confirmed by at least one engine pick on the same side.

### Implementation

**1. New hook: `src/hooks/useHighConvictionPlays.ts`**

- Fetches today's `mispriced_lines` and all engine picks (reusing the same queries from `useEngineComparison`)
- Normalizes prop types with a mapping function: strips `player_`, `batter_`, `pitcher_` prefixes for comparison (so `player_points` matches `points`)
- Joins on `normalized_prop_type + lowercase player_name`
- For each overlap, computes a **conviction score** based on:
  - Mispriced edge magnitude (higher = better)
  - Mispriced confidence tier (ELITE +3, HIGH +2, MEDIUM +1)
  - Number of engines that agree on the same side
  - Whether the mispriced signal direction matches the engine side
  - Risk engine confidence score (if available)
- Flags side agreement: does the engine pick the same direction (OVER/UNDER) as the mispriced signal?
- Returns overlaps sorted by conviction score descending

**2. New component: `src/components/market/HighConvictionCard.tsx`**

- Header: "High Conviction Plays" with a target/crosshair icon
- Summary badge: "X plays confirmed by multiple engines"
- Each row shows:
  - Player name + prop type
  - Mispriced edge % with direction
  - Mispriced confidence tier badge
  - Which engines confirmed (colored dots: Risk, PropV2, Sharp, Heat)
  - Side agreement indicator (checkmark if all agree, warning if split)
  - Conviction score bar
- Empty state: "No cross-engine overlaps today -- check back when all engines have run"
- Sorted by conviction score (highest first)

**3. Add to homepage: `src/pages/Index.tsx`**

- Place the `HighConvictionCard` right above or below the `MispricedLinesCard` for natural flow

### Prop Type Normalization

```text
normalize("player_points")       -> "points"
normalize("player_assists")      -> "assists"
normalize("player_rebounds")     -> "rebounds"
normalize("batter_hits")         -> "hits"
normalize("pitcher_strikeouts")  -> "strikeouts"
normalize("points")              -> "points"  (already clean)
```

This ensures cross-engine matching works regardless of which naming convention each engine uses.

### Files Summary

| Action | File |
|--------|------|
| Create | `src/hooks/useHighConvictionPlays.ts` |
| Create | `src/components/market/HighConvictionCard.tsx` |
| Modify | `src/pages/Index.tsx` (add card to homepage) |

