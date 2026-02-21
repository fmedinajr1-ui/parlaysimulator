

## Add Direction-Conflict Filter to Double-Confirmed Engine

### The Problem

The double-confirmed logic currently matches picks by **player name + prop type only** -- it never checks whether the sweet spot and mispriced signal agree on direction (OVER vs UNDER). This means a pick like Josh Giddey where the sweet spot says "OVER" but the mispriced signal says "UNDER" still gets the +20 bonus and enters the double-confirmed pool.

### The Fix

Two targeted changes in `supabase/functions/bot-generate-daily-parlays/index.ts`:

**Change 1: Mispriced enrichment side check (around line 4078)**

Before granting double-confirmed status, compare the mispriced signal direction (`side` variable, derived from `ml.signal`) against `sweetSpotMatch.recommended_side`. Three outcomes:

- **Sides agree** -- full double-confirmed: +20 bonus, real hit rate, tagged `isDoubleConfirmed: true`
- **Sides disagree** -- direction conflict: no bonus, keep fake hit rate, tagged `isDoubleConfirmed: false`, log a warning with `[DIRECTION CONFLICT]`
- **No sweet spot match** -- unchanged behavior (fake hit rate, no bonus)

**Change 2: Sweet spot boost side check is already correct (line 4158)**

The Step 4 boost logic already checks `sideMatch` before boosting sweet spot picks. No change needed there.

### What This Prevents

Picks like Josh Giddey (sweet spot says Points OVER, mispriced says Points UNDER) will no longer receive:
- The +20 composite score bonus
- Real hit rate replacement
- Entry into the `double_confirmed_conviction` parlay pool

They will be logged as direction conflicts so you can monitor how many occur daily.

### Code Changes

One block in `index.ts` around lines 4078-4098 -- add a side comparison before the double-confirmed grant:

```
Current: if (sweetSpotMatch && sweetSpotMatch.l10_hit_rate > 0) {
           // Grant real hit rate + bonus unconditionally
         }

New:     if (sweetSpotMatch && sweetSpotMatch.l10_hit_rate > 0) {
           const sidesAgree = sweetSpotMatch.recommended_side.toLowerCase() === side;
           if (sidesAgree) {
             // Grant real hit rate + double-confirmed bonus
           } else {
             // Log direction conflict, skip bonus, keep fake hit rate
           }
         }
```

This is a surgical 10-line change with no impact on any other strategy or pool.
