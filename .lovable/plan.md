

# Fix: Negative-Edge Blocking at Generation Time

## Problem

The bot calculates `projection_buffer` for each leg (line 1620) but never checks if it's negative before adding the leg to a parlay. This allows "dirty" legs -- where the projection contradicts the bet direction (e.g., OVER 4.5 with a 4.0 projection) -- to slip into parlays.

## Root Cause

In `generateTierParlays()`, around lines 1584-1632, player legs are built and pushed into the `legs` array without any projection buffer validation. The buffer is stored as metadata but never used as a gate.

## Fix (Single File Change)

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

Add a negative-edge blocking check right after the leg data is constructed (after line 1625), before the leg is pushed into the array. The check will:

1. For **OVER** bets: reject if `projected_value <= line` (projection doesn't exceed the line)
2. For **UNDER** bets: reject if `projected_value >= line` (projection doesn't go below the line)
3. Log each blocked leg so we can track filtering in production

### Exact Change Location

Inside `generateTierParlays()`, after the player leg `legData` object is built (around line 1625) and before `legs.push(legData)` (line 1632), insert:

```text
// NEGATIVE-EDGE GATE: Block legs where projection contradicts bet direction
const projBuffer = legData.projection_buffer || 0;
const projValue = legData.projected_value || 0;
if (projValue > 0 && projBuffer < 0) {
  console.log(`[NegEdgeBlock] Blocked ${legData.player_name} ${legData.prop_type} ${legData.side} ${legData.line} (proj: ${projValue}, buffer: ${projBuffer.toFixed(1)})`);
  continue;
}
```

This is a 5-line insertion. No other files need changes. The gate fires per-leg inside the candidate loop, so blocked legs are simply skipped and the next candidate is tried instead.

## Why This Works

- Catches the exact scenario that produced the 18 dirty parlays today
- Uses data already computed (`projected_value` and `projection_buffer`) -- no new queries needed
- `projValue > 0` guard ensures we only block when we actually have projection data (avoids false blocks on team legs or missing data)
- Placed before `legs.push()` so dirty legs never enter any parlay
- Logging enables monitoring of how many legs get blocked per run

## No Impact On

- Team prop legs (they don't have `projection_buffer`)
- Legs with legitimate positive edges (buffer >= 0 passes through)
- Overall parlay count (blocked legs are replaced by next best candidate)

