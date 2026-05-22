---
name: profitability-math
description: Per-strategy Bayesian hit-rate smoother + ¼-Kelly staking + EV gates that make mixed 7W/12L days profitable
type: feature
---

- Feature flag: `BANKROLL_MATH_V1` env var on `parlay-engine-v2` and
  `cross-sport-parlay-generator`. Default OFF so legacy behaviour is preserved
  until backtest confirms day-over-day improvement.
- Bankroll envelope: `BANKROLL_UNITS` (default 1000) and `BANKROLL_DAILY_FRAC`
  (default 0.20) cap total daily stake at 200u; tickets are scaled down
  proportionally if Kelly demands more.
- Per-ticket sizing: `quarterKellyStake(p̂, D, bankroll, cap=0.25)` where
  `p̂` is the Bayesian-smoothed hit rate (`(wins + α·prior)/(n + α)`, α=10)
  blended with leg-count priors `single 0.52 / 3-leg 0.55 / 4-leg 0.40 /
  5-leg 0.25 / 8-leg 0.04`. Falls back to the engine's claimed combined
  probability when n<5 graded samples exist for the strategy.
- Per-strategy gates (all must pass to persist a ticket):
  - 7d `rolling_ev_per_unit ≥ 0` once n≥5 (auto-suspends strategies bleeding
    units, e.g. `cross_sport_stretch_4` after a 0/4 day).
  - Combined decimal odds ≥ `(1/p̂) × 1.10` (10% cushion above breakeven,
    `BANKROLL_ODDS_CUSHION`).
  - Kelly stake ≥ `bankroll × 0.002` (skip <0.2% of bankroll tickets).
- Data: `strategy_pnl_rolling(strategy_name, window_days, n, wins, losses,
  voids, hit_rate, p_smoothed, avg_decimal_odds, avg_leg_count,
  rolling_ev_per_unit, rolling_roi, breakeven_min_decimal)` refreshed at the
  end of every `cross-sport-parlay-settler` run for windows 7 and 30.
- Math reference: `EV(u) = stake × [p̂·(D−1) − (1−p̂)]`. Breakeven D = `1/p̂`.
  Yesterday's 7W/12L day backed out to **+167 % ROI** even at flat 50u stakes
  because lottery winners at +1379/+1360/+1152 covered every loss; gating
  `stretch_4` (0/4) and `ladder_challenge` (1/3 at −110) lifts the floor on
  worse slates.
- Shared util: `supabase/functions/_shared/staking/kelly.ts` (no Supabase deps;
  exports `bayesianHitRate`, `quarterKellyStake`, `breakevenDecimal`,
  `requiredDecimal`, `evPerUnit`, `priorForLegCount`). 5 unit tests in
  `__tests__/kelly.test.ts`.