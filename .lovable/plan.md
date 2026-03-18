

# Tri-Signal Hedge Projection Engine

## Overview
Replace the simple rate-based projection with a blended formula using three signals: live rate, book-implied line, and FG efficiency. Apply it in both the client-side War Room AND the server-side Telegram hedge tracker so alerts fire with tighter, more accurate projections immediately.

## Changes

### 1. Extract FG data from ESPN boxscore
**File**: `supabase/functions/unified-player-feed/index.ts`

ESPN labels include `fg` (format "5-12"), `3pt` ("2-5"), `ft` ("3-4"). Parse FGM/FGA/3PM/3PA and add to `currentStats`:

```typescript
// Parse "5-12" → { made: 5, attempted: 12 }
const fgParts = (stats.fg || '0-0').split('-');
const fgm = parseInt(fgParts[0]) || 0;
const fga = parseInt(fgParts[1]) || 0;
const threeParts = (stats['3pt'] || '0-0').split('-');
const threePm = parseInt(threeParts[0]) || 0;
const threePa = parseInt(threeParts[1]) || 0;

currentStats.fgm = fgm;
currentStats.fga = fga;
currentStats.fgPct = fga > 0 ? fgm / fga : 0;
currentStats.threePm = threePm;
currentStats.threePa = threePa;
```

### 2. Build tri-signal projection engine
**New file**: `src/lib/triSignalProjection.ts`

Pure function that blends three signals with game-progress-based weights:

```text
projectedFinal = (w_rate × rateProj) + (w_book × bookProj) + (w_fg × fgAdjustedProj)

Q1: rate=0.40, book=0.45, fg=0.15
Q2: rate=0.45, book=0.35, fg=0.20
Q3: rate=0.55, book=0.25, fg=0.20
Q4: rate=0.70, book=0.15, fg=0.15
```

- **Rate projection**: existing `current + blendedRate × remainingMinutes`
- **Book projection**: live book line used directly as market-implied final
- **FG adjustment**: soft regression factor `(baselineFgPct / liveFgPct)^0.3` applied to rate projection (scoring props only; non-scoring redistributes `w_fg` to `w_rate`)

### 3. Wire into client pipeline
**File**: `src/hooks/useSweetSpotLiveData.ts`

After getting `projection` and `liveLineData`, call `calculateTriSignalProjection()` and replace `projectedFinal` in the `LivePropData` object. Pass through `fgPct` from `player.currentStats`.

### 4. Mirror in Telegram hedge tracker (critical for immediate effect)
**File**: `supabase/functions/hedge-live-telegram-tracker/index.ts`

The server-side tracker currently uses its own simple `calculateHedgeAction` (lines 26-43) with only rate-based `projectedFinal` from the unified feed. Update it to:
- Read the new FG fields from the live feed response
- Read `liveBookLine` from `category_sweet_spots` or a live-lines fetch
- Apply the same tri-signal formula inline (duplicated as a standalone function since edge functions can't import from `src/lib`)
- This ensures Telegram alerts fire with the improved projections immediately

### 5. Tighten hedge thresholds
**File**: `src/lib/hedgeStatusUtils.ts` + `hedge-live-telegram-tracker/index.ts`

With higher-fidelity projections, tighten Q3/Q4 thresholds:

| Quarter | Current `onTrack` | New `onTrack` | Current `alert` | New `alert` |
|---------|-------------------|---------------|-----------------|-------------|
| Q3 (50-75%) | 2.0 | 1.5 | -1.0 | -0.5 |
| Q4 (75-100%) | 1.5 | 1.0 | -1.0 | -0.5 |

Both the client util and the edge function copy get updated identically.

### 6. Deploy and verify
Deploy `unified-player-feed` and `hedge-live-telegram-tracker`. The Telegram cron (every 5 min) will pick up the new projection logic on the next cycle — no manual trigger needed.

## Files to Change
| File | Change |
|------|--------|
| `supabase/functions/unified-player-feed/index.ts` | Parse FG/3PT/FT splits, add to currentStats |
| `src/lib/triSignalProjection.ts` | New tri-signal projection engine |
| `src/hooks/useSweetSpotLiveData.ts` | Wire tri-signal into enrichment |
| `src/lib/hedgeStatusUtils.ts` | Tighten Q3/Q4 thresholds |
| `supabase/functions/hedge-live-telegram-tracker/index.ts` | Add tri-signal + tightened thresholds |

