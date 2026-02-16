

# Fix: Block OVER_TOTAL from Single Picks + Flip to UNDER

## Problem

The single-pick fallback generator bypasses the `bot_category_weights` blocking system. NCAAB OVER_TOTAL has a 29.4% hit rate and is auto-blocked (weight=0), but the fallback still generates OVER total picks because it only checks `composite_score` and `hit_rate` -- not the weightMap.

Today's output included 4 NCAAB OVER total single picks that should never have been generated.

## Solution

Add a weight/block check inside the single-pick fallback loop. For team picks with blocked categories (weight=0), attempt to flip to the opposite side (OVER -> UNDER) if the flipped side has a positive weight. If neither side passes, skip the pick entirely.

## Changes to `bot-generate-daily-parlays/index.ts`

### In the single-pick fallback loop (~line 4587)

After the composite/hitRate filter and before the dedup key, add:

```text
1. Look up the pick's category weight from weightMap using the same 
   hierarchical key logic (category__side__sport > category__side > category)

2. If weight === 0 (blocked):
   a. For team picks with bet_type === 'total':
      - Flip side: 'over' -> 'under' or 'under' -> 'over'
      - Flip category: 'OVER_TOTAL' -> 'UNDER_TOTAL' or vice versa
      - Check if the flipped side's weight > 0
      - If yes: use the flipped pick (update side, category on the pick)
      - If no: skip the pick entirely
   b. For all other blocked categories: skip the pick entirely

3. If weight > 0 but < 0.5: skip the pick (too weak for single bets)
```

### Flip Logic Detail

```text
function flipTotalSide(pick, weightMap):
  if pick.bet_type !== 'total': return null
  
  flippedSide = pick.side === 'over' ? 'under' : 'over'
  flippedCategory = pick.side === 'over' ? 'UNDER_TOTAL' : 'OVER_TOTAL'
  sport = pick.sport || 'basketball_nba'
  
  flippedWeight = weightMap.get(flippedCategory__flippedSide__sport) 
                  ?? weightMap.get(flippedCategory__flippedSide) 
                  ?? 1.0
  
  if flippedWeight > 0:
    return { ...pick, side: flippedSide, category: flippedCategory }
  return null
```

### What This Fixes

- NCAAB OVER_TOTAL picks (29.4% hit rate, blocked) will be auto-flipped to UNDER_TOTAL (70.6% hit rate, weight 1.20)
- Any other blocked category in single picks will be skipped
- Weak categories (weight < 0.5) won't appear in single picks either
- The same hierarchical sport-aware weight lookup used by the parlay generator is now respected by the fallback

### Files Modified

| File | Change |
|------|--------|
| `supabase/functions/bot-generate-daily-parlays/index.ts` | Add weightMap check + side-flip logic in single-pick fallback loop |

