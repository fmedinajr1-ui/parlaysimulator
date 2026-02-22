
## Live Mispriced Line Scanner — Pre-Hedge Intelligence Layer

### What This Does
Adds a **"Line Value Scanner"** that runs on every live line refresh (before hedge recommendations) and flags props where the current book line is mispriced relative to:
- **L10 average** (player's recent performance floor)
- **Game pace** (fast/slow games shift projections)
- **Original opening line** (line movement direction)
- **Projected final** (live AI projection vs current book line)

Each prop in the Hedge Mode table gets a new **"Line Value"** column showing whether the live line is SHARP (correctly priced), SOFT (mispriced in your favor), or STALE (moved against you).

### How It Works

```text
For each prop in the war room:

  L10 Avg = player's last 10 game average for this stat
  Pace Multiplier = game pace rating / 100 (e.g., 1.05 for fast game)
  Pace-Adjusted L10 = L10 Avg * Pace Multiplier

  Live Book Line = current sportsbook line
  Original Line = line when bet was placed

  -- Edge vs L10 baseline --
  If bet is OVER:
    l10Edge = Pace-Adjusted L10 - Live Book Line
  If bet is UNDER:
    l10Edge = Live Book Line - Pace-Adjusted L10

  -- Projection edge --
  If bet is OVER:
    projEdge = Projected Final - Live Book Line
  If bet is UNDER:
    projEdge = Live Book Line - Projected Final

  -- Line drift (has the line moved for or against you?) --
  If bet is OVER:
    lineDrift = Original Line - Live Book Line  (positive = line dropped = good for over)
  If bet is UNDER:
    lineDrift = Live Book Line - Original Line  (positive = line went up = good for under)

  -- Composite mispricing score --
  mispricingScore = (l10Edge * 0.4) + (projEdge * 0.35) + (lineDrift * 0.25)

  -- Classification --
  If mispricingScore >= 1.5: SOFT (line is favorable, good value)
  If mispricingScore <= -1.5: STALE (line moved against you)
  Otherwise: SHARP (correctly priced)
```

### UI Changes

**Hedge Mode Table** — New "Value" column between "Gap" and "Action":

| Prop | Now | Need | Progress | Projected | Gap | **Value** | Action | Hedge |
|------|-----|------|----------|-----------|-----|-----------|--------|-------|
| Chet PTS O | 8 | 18.5 | ---- | 20.1 | +1.6 | **SOFT** | HOLD | — |
| Wiggins PTS O | 4 | 14.5 | -- | 10.0 | -4.5 | **STALE** | HEDGE | UNDER 14.5 |

- **SOFT** = green pill — line is mispriced in your favor (L10 + pace say this should clear)
- **SHARP** = gray pill — line is correctly priced, no edge
- **STALE** = red pill — line has moved against you or L10 doesn't support this line

Each pill has a tooltip showing the breakdown (L10 edge, pace adjustment, line drift).

### Files to Create/Modify

**1. New file: `src/lib/liveMispricedLineScanner.ts`**
- Pure utility function: `calculateLineMispricing(props)` 
- Takes the WarRoomPropData array (which already has L10 hit rate, pace rating, live book line, projected final, original line)
- Returns a Map of prop ID to mispricing result (score, classification, breakdown)
- No API calls — uses data already in memory

**2. Modify: `src/components/scout/warroom/HedgeModeTable.tsx`**
- Import and call `calculateLineMispricing` on the props array
- Add "Value" column header with tooltip
- Add value pill to each row (SOFT/SHARP/STALE with color coding)
- Tooltip shows: "L10 edge: +2.1 | Pace adj: 1.05x | Line drift: +0.5"

**3. Modify: `src/components/scout/warroom/WarRoomPropCard.tsx`** (interface only)
- Add `l10Avg` field to `WarRoomPropData` interface (needed for L10 baseline)

**4. Modify: `src/components/scout/warroom/WarRoomLayout.tsx`**
- Pass `l10Avg` from the sweet spot's `l10Stats.avg` into the prop card data

### Technical Details

The scanner is a pure client-side calculation — no new API calls or edge functions. All the data it needs is already available in the `WarRoomPropData`:
- `hitRateL10` and L10 avg from sweet spot analysis
- `paceRating` from live feed
- `liveBookLine` from batch odds
- `line` (original line)
- `projectedFinal` from live projection
- `side` (OVER/UNDER)

This runs synchronously in the render cycle via `useMemo`, so it's instant and doesn't add any latency.

**No database changes. No new edge functions. 4 files touched (1 new, 3 modified).**
