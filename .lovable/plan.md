# Fix mega-lottery gradability + build a profitability math layer

## Part 1 — Make `mega_lottery_scanner` legs gradable

**Why:** Yesterday's mega-lottery rows landed in `bot_daily_parlays` with
`team: null`, `opponent: null`, `game_description: null` on team-market legs, so
the settler can't resolve which game they belong to and falls back to
`ungradable_missing_context`. Two leak points:

1. `parlay-engine-v2/index.ts buildExtraCandidates()` calls `parseTeams(r.game_description)`. When `game_description` is null the function returns `{ team: "UNK", opponent: "UNK" }` and the team-market candidate is still emitted. We then persist `"UNK"` (or null) and the settler has nothing to match on.
2. `mega_lottery_scanner` in `_shared/parlay-engine-v2/strategies.ts` doesn't enforce that team-market legs carry a usable game context — it only enforces `MIN_PLAYER_LEGS_IN_LOTTERY`.

**Changes**

- In `parlay-engine-v2/index.ts buildExtraCandidates()` for team-market rows:
  - If `r.game_description` is missing, try `home_team`/`away_team` fallback fields from `unified_props` (extend the `select(...)` list to pull them).
  - If both `team` and `opponent` still resolve to `"UNK"`, drop the candidate with `bump("extra:missing_game_context")` instead of emitting it.
  - Always set `event_id` (use `r.event_id` if present; otherwise build a stable `${date}|${home}|${away}|${market}` hash) so the parlay-level `one-team-leg-per-game` gate keeps working.
- In `_shared/parlay-engine-v2/strategies.ts` `megaLotteryScanner`:
  - Filter `eligible` to exclude any leg where (`player_name == null` AND (`team == null || team == "UNK"` OR `game_description == null`)).
  - Count it as a rejection reason `mega:team_leg_missing_context` so we can see it in `GenerationReport`.
- Persist path (`parlay-engine-v2/index.ts` row builder, ~line 595) already writes `team`, `opponent`, `game_description`. Add `event_id` and `market_type` (derive from `signal_source`: `TEAM_*` → `"moneyline"`/`"spread"`/`"total"`, otherwise `"player"`) so settler v2's `classifyLeg` resolves on the first try.
- Update `mem://logic/parlay/cross-sport-generator.md` — remove the TODO line.

**Tests** (5 required, per project rule):

1. `buildExtraCandidates` drops a team row when `game_description` is null AND no `home_team`/`away_team` fallback.
2. `buildExtraCandidates` builds a valid team leg when `home_team`/`away_team` are provided but `game_description` is null.
3. `megaLotteryScanner` rejects a combo containing a `UNK`/no-context team leg, even if `MIN_PLAYER_LEGS_IN_LOTTERY` is satisfied.
4. Settler v2 grades a `mega_lottery_scanner` ticket end-to-end (player leg + spread leg + total leg) when the persisted shape includes `team`/`opponent`/`market_type`.
5. Persist row builder writes `market_type: "spread"` for a `TEAM_SPREAD_FAV` leg and `market_type: "player"` for a batter prop.

## Part 2 — Profitability mathematics for a 7W / 12L day

### Yesterday's actual numbers (graded, stake-weighted)

| Strategy | W-L | Stake (u) | Win profit | Loss | Net | ROI |
|---|---|---|---|---|---|---|
| cross_sport_lottery_5 | 3-3 | 300 | +1,945.5 | −150 | **+1,795** | **+598%** |
| cross_sport_strong_3 | 3-2 | 250 | +363 | −100 | **+263** | **+105%** |
| ladder_challenge | 1-2 | 300 | +101 | −200 | **−99** | **−33%** |
| cross_sport_stretch_4 | 0-4 | 200 | 0 | −200 | **−200** | **−100%** |
| mega_lottery_scanner | 0-1 | 0.37 | 0 | −0.37 | **−0.4** | **−100%** |
| **TOTAL** | **7-12** | **1,050** | **+2,409** | **−650** | **+1,759** | **+167%** |

The book was already +167% ROI yesterday. The 7W/12L surface number hides that the lottery winners (+1379, +1360, +1152) more than pay for every loss. What kills the day on a "bad" lottery slate is `stretch_4` and `ladder_challenge` flat-staking into negative EV.

### The math we'll codify

For each ticket: `EV(u) = stake × [ p × (D − 1) − (1 − p) ]`, where `D` is combined decimal odds and `p` is the **empirical** (not claimed) win rate.

For a strategy `s` with rolling 30d hit-rate `p_s`, breakeven decimal odds is `D_min(s) = 1 / p_s`.

**Bayesian smoother for early samples** (so a strategy with 1-of-3 doesn't lock to 33%):
`p_s = (wins + α·p_prior) / (n + α)`, with `α = 10`, `p_prior` = leg-count-class baseline (3-leg 0.55, 4-leg 0.40, 5-leg 0.25, single 0.52).

**Quarter-Kelly stake per ticket** (cap at quarter-Kelly to absorb p-uncertainty):
`f* = max(0, (D·p − 1) / (D − 1))`, then `stake_u = 0.25 × f* × bankroll`.

**Hard gates**
- Strategy `s` is suspended for the day if `7-day rolling EV(s) < 0` AND `n ≥ 5`.
- Per-ticket min odds: require `D ≥ 1.1 / p_s` (10 % cushion above breakeven).
- If `f* < 0.002`, set `stake_u = 0` (skip the ticket).

### Implementation

- **New table** `strategy_pnl_rolling` (materialised view-ish, refreshed by settler v2 in the same call):
  - columns: `strategy_name`, `window` (`7d`/`30d`), `n`, `wins`, `losses`, `voids`, `hit_rate`, `p_smoothed`, `avg_decimal_odds`, `rolling_ev_per_unit`, `rolling_roi`, `breakeven_min_decimal`, `updated_at`.
  - Refreshed at the end of `cross-sport-parlay-settler` after grading.
- **New shared util** `supabase/functions/_shared/staking/kelly.ts` exporting:
  - `bayesianHitRate(wins, n, prior, alpha=10)`
  - `quarterKellyStake(p, decimalOdds, bankrollUnits, cap=0.25)`
  - `breakevenDecimal(p)` and `requiredDecimal(p, cushion=0.10)`
- **Plug into the generators** (`parlay-engine-v2/index.ts` and `cross-sport-parlay-generator/index.ts`):
  - Before persisting each ticket, read `strategy_pnl_rolling` row for its `strategy_name`, drop the ticket if `rolling_ev_per_unit < 0` (after 5 graded samples) or if `combinedDecimalOdds < requiredDecimal(p_smoothed, 0.10)`.
  - Replace flat `STAKE_BY_TIER` with `quarterKellyStake(p_smoothed, combinedDecimalOdds, bankroll_units=1000)`. Persist the actual stake to `simulated_stake` and the rolling p as `combined_probability` so the broadcast/UI reflects empirical math, not optimistic prior.
- **Daily bankroll envelope**: also enforce `Σ stake_units ≤ 0.20 × bankroll` per day; if the math wants more, scale all tickets down proportionally.

### Telegram / UI surfacing

Append a one-line math footer to each parlay broadcast:
`p̂ 0.34 · req D≥2.94 · D 3.48 · Kelly 1.7u (¼-Kelly, BR 1000u)`
This is the user-facing "why this stake" so we never have to defend flat-50u on a 0/4 strategy again.

### Tests for the math layer (5 required)

1. `bayesianHitRate(2, 3, 0.40, 10)` ≈ `(2 + 4) / (3 + 10)` = `0.462` (sanity).
2. `quarterKellyStake(0.55, 2.40, 1000)` returns ~5.94u (`0.25 × ((2.40·0.55−1)/1.40) × 1000`).
3. Generator skips a 4-leg ticket where rolling `p_smoothed=0.10` and `D=2.5` (req `D ≥ 1.1/0.10 = 11.0`, fails).
4. Settler refresh fills `strategy_pnl_rolling` with correct `rolling_ev_per_unit` for a fixture of 7W/12L tickets and the row matches the hand-calc.
5. Daily envelope cap: 50 generated tickets each demanding 30u get scaled to `200u / 50 = 4u` each so `Σ ≤ 200u`.

## Order of operations before tonight's batch

1. Land Part 1 (mega-lottery gradability) — small, isolated, can ship + redeploy quickly.
2. Run settler once to refresh `cross_sport_leg_feedback` aggregates.
3. Land Part 2 (Kelly + strategy gates + envelope) behind a feature flag `BANKROLL_MATH_V1=true`, default off.
4. Backtest Part 2 against the 19-ticket fixture from yesterday — confirm `stretch_4` and `ladder_challenge` are auto-suppressed and the day still nets ≥ +150 % ROI.
5. Flip the flag on for today's 09:30 / 10:00 ET generator cycle.

## Files touched

- `supabase/functions/parlay-engine-v2/index.ts` (extra-candidate guards, persist `event_id`/`market_type`, Kelly stake call)
- `supabase/functions/_shared/parlay-engine-v2/strategies.ts` (`megaLotteryScanner` team-context filter)
- `supabase/functions/_shared/staking/kelly.ts` (new)
- `supabase/functions/cross-sport-parlay-generator/index.ts` (same gates + Kelly call)
- `supabase/functions/cross-sport-parlay-settler/index.ts` (refresh `strategy_pnl_rolling` at end of run)
- `supabase/migrations/<ts>_strategy_pnl_rolling.sql` (new table + service-role-only RLS)
- `supabase/functions/parlay-engine-v2-broadcast/index.ts` (one-line math footer)
- `mem/logic/parlay/cross-sport-generator.md` (drop TODO, link to new memory)
- `mem/logic/betting/profitability-math.md` (new — Kelly fractions, Bayesian smoother, strategy-gate rules)