---
name: WNBA backtest weighting
description: Backtest rows in fanduel_prediction_accuracy count toward gate sample/hit-rate at 0.7x; live rows at 1.0x. Powers the WNBA cold-start unlock.
type: feature
---
The WNBA cold-start uses three edge functions: `wnba-backfill-box-scores` (ESPN, free), `wnba-backfill-odds` (The Odds API historical, ~10 credits/market/snapshot/event), and `wnba-backtest-signals` (replays signal logic, writes graded rows tagged `settlement_method='backtest'` to `fanduel_prediction_accuracy`).

In `signal-alert-engine`'s `loadTakeItNowPropStats`, backtest rows contribute `BACKTEST_ROW_WEIGHT = 0.7` to both `hits` and `total` (live rows = 1.0). This means:
- A backtest with n=72 raw rows contributes ~50.4 weighted toward the `TAKE_IT_NOW_MIN_SAMPLE_30D=50` floor.
- A 60% backtest hit rate stays at 60% rate (weighting cancels in the ratio), so quality still has to clear `0.524` break-even.
- As live rows accumulate, they dominate naturally (weight 1.0 > 0.7).

Any new signal gate that counts toward unlock thresholds MUST apply the same per-row weighting so backtest data is honest, never silently treated as live.

v1 backtest replay only implements `take_it_now`. Add additional signals by extending `wnba-backtest-signals` (cheap once odds are loaded).