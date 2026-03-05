
# Floor & Ceiling Parlay Tiers — IMPLEMENTED ✅

## What Was Added
Two new parlay strategies using L10 game log floor/ceiling data:

### 🔒 Floor Lock (Safe Parlays)
- **Concept**: Only picks where the player's worst game in L10 still clears the betting line
- **Gate**: `l10_min >= line * 0.85` for overs (relaxed from 100% — 0 candidates with real sportsbook lines at strict threshold), `l10_max <= line * 1.15` for unders
- **Safety backstop**: Requires `l10_hit_rate >= 80%` to ensure consistency
- **Line**: Standard sportsbook line (safety IS the floor guarantee)
- **Profiles**: 4 execution (70%+ hit rate), 4 exploration (60%+ hit rate)

### 🎯 Ceiling Shot (Risky Parlays)
- **Concept**: Alt lines near the player's L10 ceiling with plus-money odds
- **Gate**: `l10_max >= line * 1.3` (ceiling must be 30%+ above standard line)
- **Line**: Alternate line near L10 max with odds > +100
- **Profiles**: 3 execution (55%+ hit rate), 4 exploration (45%+ hit rate)

## Profile Ordering Fix (March 5, 2026)
Floor/ceiling profiles moved to **top** of both exploration and execution profile arrays to avoid Edge Function timeout. Previously positioned at bottom (~position 85+ of 92), never reached before 150s timeout.

## Timeout Guard
Added 140s wall-clock guard in profile iteration loop. Logs remaining skipped profiles when triggered.

## Files Changed
1. `supabase/functions/bot-generate-daily-parlays/index.ts`:
   - Extended `SweetSpotPick` with `l10_min`, `l10_max`, `l10_avg`, `l10_median`
   - Added `selectFloorLine()` and `selectCeilingLine()` functions
   - Added `floor_lock` and `ceiling_shot` strategy profiles to execution + exploration tiers (at TOP of arrays)
   - Added strategy-specific candidate filtering in the parlay assembly loop
   - Applied ceiling line override during leg assembly for ceiling_shot picks
   - Labeled parlays with `🔒 FLOOR LOCK` / `🎯 CEILING SHOT` in `selection_rationale`
   - Added 140s timeout guard with logging
   - Relaxed floor gate to 85% of line (from 100%) with 80% L10 hit rate backstop
