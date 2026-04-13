

# Tighten RBI 3-Leg Parlay + Add Conflict Guard

## Problem
1. The 3-leg RBI parlay missed April 12th because Jordan Walker (the 3rd leg) had 1 RBI — weaker candidates slip into the 3rd slot
2. Contradictory Over/Under signals fire for the same player (e.g., Hyeseong Kim, Ildemaro Vargas), creating noise and wasted picks

## Changes

### 1. Add RBI Conflict Guard to `generate-rbi-parlays/index.ts`
Before scoring candidates, deduplicate conflicting signals for the same player+prop. When both Over and Under exist for the same player, keep only the one with the highest `confidence + velocity` score. This matches the "Hard Conflict Guard" pattern used elsewhere in the system.

### 2. Tighten 3rd Leg Selection in `generate-rbi-parlays/index.ts`
Add stricter gates for the 3rd leg of the 3-Leg Sniper:
- **L10 hit rate gate**: For Under picks, require L10 hit rate ≤ 0.3 (player had 0 RBI in 7+ of last 10). For Over picks, require L10 hit rate ≥ 0.6
- **Minimum composite score threshold**: 3rd leg must score within 80% of the top leg's score (no weak tail picks)
- **Lower the candidate threshold from 5 to 4** (current code requires `scored.length >= 5` which is too restrictive)

### 3. Invoke the parlay generator for today (April 13th)
After deploying the updated function, invoke `generate-rbi-parlays` to get today's parlay picks and report results.

## Technical Detail

| File | Changes |
|------|---------|
| `supabase/functions/generate-rbi-parlays/index.ts` | Add conflict dedup before Step 3; add L10 + score gates for 3rd leg selection; lower 3-leg threshold from 5→4 |

No database changes needed.

