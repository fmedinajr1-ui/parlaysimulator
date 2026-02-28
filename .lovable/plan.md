
# Fix: Lower minLegs and Add Single-Player Fallback

## Root Cause (from live test)

Both engines still produced 0 parlays despite the threshold changes:

1. **Sharp Builder**: Found 2 candidates (both Herb Jones). BALANCED and UPSIDE assembled 2 legs each, but `minLegs` is **3** for both -- save condition `2 >= 3` fails. SAFE got 0 legs because Dream Team validation rejected Herb Jones rebounds (minutes 27.3 < 28 minimum).

2. **Heat Engine**: Only 2 eligible props, both Herb Jones. `buildParlays()` requires 2 **different players** (line 591). With only 1 unique player, both CORE and UPSIDE return null.

## Fix Plan

### 1. Sharp Builder: Lower minLegs for BALANCED and UPSIDE

**File:** `supabase/functions/sharp-parlay-builder/index.ts`

| Config | Current minLegs | New minLegs |
|--------|----------------|-------------|
| SAFE | 2 | 2 (keep) |
| BALANCED | 3 | 2 |
| UPSIDE | 3 | 2 |

This allows 2-leg parlays to save when only 2 candidates are available.

### 2. Sharp Builder: Lower Dream Team Minutes Threshold

The SAFE parlay rejected Herb Jones rebounds because minutes (27.3) was below the 28-minute minimum. Lower this to **25** so role players with adequate minutes aren't blocked.

**File:** `supabase/functions/sharp-parlay-builder/index.ts`

Find the Dream Team minutes check (currently `< 28`) and change to `< 25`.

### 3. Heat Engine: Allow Same-Player 2-Leg Parlays as Fallback

When `buildParlays()` can't find 2 different players, fall back to allowing 2 legs from the same player (different prop types). This is a last-resort -- the existing different-player logic runs first.

**File:** `supabase/functions/heat-prop-engine/index.ts`

In `buildParlays()` (around line 590), after the current `leg2` search fails to find a different player:
- Add a fallback that picks a same-player leg with a **different prop category** (e.g., Herb Jones rebounds + Herb Jones points)
- Log a warning when using the same-player fallback
- Mark the parlay with a `same_player_fallback: true` flag in the summary

### 4. Heat Engine: Lower Fallback Query Thresholds

The scan step's fallback query still uses the old `0.60` L10 hit rate threshold (only the confidence was lowered to 0.45). Lower the L10 threshold too.

**File:** `supabase/functions/heat-prop-engine/index.ts`

Find the fallback `.gte("l10_hit_rate", 0.60)` and change to `.gte("l10_hit_rate", 0.50)`.

## Summary of Changes

| Change | File | Why |
|--------|------|-----|
| BALANCED minLegs 3 to 2 | sharp-parlay-builder | 2-leg parlays can save |
| UPSIDE minLegs 3 to 2 | sharp-parlay-builder | 2-leg parlays can save |
| Dream Team minutes 28 to 25 | sharp-parlay-builder | Role players pass SAFE validation |
| Same-player fallback in buildParlays | heat-prop-engine | Single-player slates produce output |
| Lower fallback L10 to 0.50 | heat-prop-engine | More candidates enter the tracker |

## Files Modified

1. `supabase/functions/sharp-parlay-builder/index.ts` -- minLegs, minutes threshold
2. `supabase/functions/heat-prop-engine/index.ts` -- same-player fallback, L10 threshold
