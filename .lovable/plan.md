

# Loosen Diversity Rebalance on Light-Slate Days

## Problem
Today (March 15): 16 parlays generated, 14 voided by exposure cap → only 2 survived. With just 5 qualifying players, the max-2-per-player-prop cap is too aggressive — nearly every parlay shares the same legs.

## What to Change

### In `bot-daily-diversity-rebalance/index.ts`
Make the function **self-aware of light-slate conditions** by counting today's unique players in pending parlays. When ≤ 8 unique players exist:

| Threshold | Normal | Light-Slate |
|---|---|---|
| Strategy family cap | 40% | **60%** |
| Player-prop exposure cap | 2 | **3** |
| Min floor per family | 2 | **3** |

### Detection Logic
After fetching pending parlays, also fetch their legs to count distinct players. If `uniquePlayers ≤ 8`, apply relaxed thresholds. No changes needed to callers — the function auto-detects internally.

### Why These Specific Loosening Values
- **Exposure cap 2 → 3**: With 5 players, every 3-leg parlay must reuse someone. Allowing 3 appearances per player-prop-side lets ~6-8 parlays survive instead of 2, without creating dangerous single-leg-failure cascading (which starts around 5+).
- **Strategy cap 40% → 60%**: On thin slates, fewer engines produce valid output, so one family naturally dominates. 60% prevents total monopoly while not voiding viable picks.
- **NOT loosening further**: Keeping the cap at 3 (not unlimited) still protects against a single bad leg sinking the whole slate.

### No Change To
- The `bot-generate-daily-parlays` light-slate logic (already handles generation-side throttling)
- Any caller code — rebalance detects light-slate internally

