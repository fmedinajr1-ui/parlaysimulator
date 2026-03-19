

# Backtest: March 12th Filters vs Current Filters

## What the Data Already Shows

From querying actual `bot_daily_parlays` results:

**Pre-March 12 (Mar 1–12): 416 settled, 97 won = 23.3% win rate**
**Post-March 12 (Mar 13–18): 37 settled, 7 won = 18.9% win rate**

### Strategy Breakdown — Pre vs Post March 12

| Strategy | Pre-Mar12 WR | Post-Mar12 WR | Change |
|----------|-------------|---------------|--------|
| grind_stack (execution) | 43.6% (44/101) | 25.0% (1/4) | -18.6% |
| optimal_combo (exploration) | 20.0% (13/65) | 16.7% (3/18) | -3.3% |
| shootout_stack (execution) | 10.3% (9/87) | 33.3% (1/3) | +23.0% |
| cross_sport_4 | 100% (6/6) | no data | — |

**Key finding**: `grind_stack` was your best strategy at 43.6% pre-Mar12, dropped to 25% after. The high void rates post-Mar12 (43–90 voids/day) suggest new filters are killing too many parlays.

## Plan

Since you already have `run-parlay-backtest` which compares v5 vs v6 filter configs, I'll:

1. **Run a direct data analysis** using the database to produce a detailed comparison report — leg hit rates, strategy performance, void rates, and filter impact across the two periods
2. **Query leg-level data** from the actual parlays to identify which specific filter changes (composite hard block, grind-over block, etc.) are causing the most damage
3. **Output a report** to `/mnt/documents/` with actionable findings

This is a data task — I'll run it as a script rather than building UI.

### Deliverable
A detailed comparison report (CSV + summary) showing:
- Daily win rates pre vs post March 12
- Strategy-level performance shifts
- Void rate explosion analysis (which filter is voiding the most)
- Leg hit rate comparison
- Specific recommendations on which filters to revert

