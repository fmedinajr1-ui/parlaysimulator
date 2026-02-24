

## Tighten Prop Type Normalization Across the Entire Pipeline

### Problem Summary

The pipeline has **5 remaining functions** still using broken or inconsistent prop type normalization. This means combo props (PRA, PR, PA, RA) and prefixed props are failing to match during cross-referencing, causing valid high-conviction picks to slip through undetected.

### Mismatch Map

| Function | Current Logic | Combos Match? | Issue |
|---|---|---|---|
| `high-conviction-analyzer` | Unified (regex combos) | YES | Already fixed |
| `bot-force-fresh-parlays` | Unified (regex combos) | YES | Already fixed |
| `nba-mega-parlay-scanner` | Unified (regex combos) | YES | Already fixed |
| **`telegram-webhook`** | Strips prefix only | **NO** | `points_rebounds_assists` stays as-is, never matches `pra` |
| **`double-confirmed-scanner`** | Strips prefix + ALL underscores | **NO** | `points_rebounds_assists` becomes `pointsreboundsassists` |
| **`bot-generate-daily-parlays`** (inline normProp) | Strips prefix only (3 locations) | **NO** | Risk engine and multi-engine maps miss combos |
| **`bot-generate-daily-parlays`** (PROP_TYPE_NORMALIZE map) | Has combos but only for `player_` prefix | **PARTIAL** | Misses `pra`, `pts_rebs_asts`, etc. |
| **`recurring-winners-detector`** | Raw `.toLowerCase()` only | **NO** | `player_points` never matches `points` |

### Fix Plan

**1. `supabase/functions/telegram-webhook/index.ts` (~line 1603)**

Replace the naive `normalizePropType` with the unified regex version that maps combo aliases to canonical short forms (pra, pr, pa, ra, threes).

**2. `supabase/functions/double-confirmed-scanner/index.ts` (~line 18)**

Replace the destructive underscore-stripping `normalizePropType` with the unified regex version. This is critical -- this scanner cross-references sweet spots with mispriced lines and is currently unable to match any combo prop.

**3. `supabase/functions/bot-generate-daily-parlays/index.ts` -- 3 inline locations**

At lines ~4497, ~4506, and ~4556, replace the inline `(prop_type).replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim()` with a call to a shared `normalizePropType()` function (same unified regex version). This fixes the risk engine map, multi-engine map, and conviction multiplier lookups.

**4. `supabase/functions/bot-generate-daily-parlays/index.ts` -- PROP_TYPE_NORMALIZE map (~line 3208)**

Expand the static map to include non-prefixed aliases so lookups work regardless of input format:

```text
Add entries:
  'points_rebounds_assists': 'pra',  'pts_rebs_asts': 'pra',  'pra': 'pra',
  'points_rebounds': 'pr',  'pts_rebs': 'pr',  'pr': 'pr',
  'points_assists': 'pa',  'pts_asts': 'pa',  'pa': 'pa',
  'rebounds_assists': 'ra',  'rebs_asts': 'ra',  'ra': 'ra',
  'three_pointers': 'threes',  'threes_made': 'threes',  'threes': 'threes',
  'points': 'points',  'rebounds': 'rebounds',  'assists': 'assists',
  'blocks': 'blocks',  'steals': 'steals',
```

**5. `supabase/functions/recurring-winners-detector/index.ts` (~lines 68, 78, 101)**

Add a `normalizePropType()` function (same unified version) and use it when building lookup keys instead of raw `.toLowerCase()`. Without this, recurring winners from `category_sweet_spots` (which stores `points`) will never match props stored as `player_points`.

**6. Redeploy all 5 modified functions.**

### The Unified Function (applied everywhere)

```typescript
function normalizePropType(raw: string): string {
  const s = (raw || '').replace(/^(player_|batter_|pitcher_)/, '').toLowerCase().trim();
  if (/points.*rebounds.*assists|pts.*rebs.*asts|^pra$/.test(s)) return 'pra';
  if (/points.*rebounds|pts.*rebs|^pr$/.test(s)) return 'pr';
  if (/points.*assists|pts.*asts|^pa$/.test(s)) return 'pa';
  if (/rebounds.*assists|rebs.*asts|^ra$/.test(s)) return 'ra';
  if (/three_pointers|threes_made|^threes$/.test(s)) return 'threes';
  return s;
}
```

### Impact

- **Double-confirmed scanner**: Will now correctly match combo sweet spots (PRA, PR, PA, RA) against mispriced combo lines -- currently matching zero combos
- **Bot daily parlay generator**: Risk engine cross-reference, multi-engine consensus map, and mispriced-to-sweet-spot lookups will all correctly resolve combo props
- **Telegram webhook**: High-conviction cross-reference in Telegram reports will match combos
- **Recurring winners detector**: Streak detection will work across prop naming formats
- **Net effect**: More valid picks enter the high-conviction pool, more cross-engine confirmations are detected, and parlay quality improves

