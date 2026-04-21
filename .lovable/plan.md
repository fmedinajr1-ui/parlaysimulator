

## Phase B: Backtest module for Parlay Engine v2

Port the Python `backtest.py` + `calibration.py` modules to TypeScript, wired to the existing `backtest_runs` / `backtest_parlay_results` tables and historical `bot_daily_parlays` data (2,566 rows). This lets you replay any date range through the v2 rules and see what v2 *would* have shipped — exactly the workflow the README describes (`python -m examples.run_backtest`).

### What gets built

**1. Shared backtest library** — `supabase/functions/_shared/parlay-engine-v2/backtest.ts`

Direct port of `backtest.py`:
- `replayParlays(parlays, legs, opts)` — runs each historical parlay's legs through v2's leg-gate chain, then through `validateParlay`, then through a fresh `ExposureTracker` second pass.
- Options match the Python defaults:
  - `strict_void_mode = true` — historical voids are treated as "v2 would have caught this via freshness gates" (no stake, no PnL).
  - `strict_confidence_mode = false` — missing confidence passes through (Feb 2026 had 100% NaN confidence).
  - `apply_exposure_caps = true` — second-pass `ExposureTracker` enforces combo-hash, player, game, and 5% duplication caps.
- Returns `BacktestReport`:
  - v1 actual: `resolved`, `won`, `wr`, `stake`, `profit`, `roi`, `void_rate`
  - v2 would-have-shipped: same metrics on the accepted subset, plus `volume_pct` (e.g. "37% of v1 volume")
  - `rejection_reasons` (top 10, same shape as `GenerationReport`)
  - `profit_foregone` (rejected winners) vs `loss_avoided` (rejected losers)
  - `top_strategies_v1` vs `top_strategies_v2` (profit concentration)
  - `same_game_breakdown` (the bucket that bug-1 in v2.0 broke — kept as a sanity counter)

**2. Calibration library** — `supabase/functions/_shared/parlay-engine-v2/calibration.ts`

Port of `calibration.py`. Pure function that takes the same `(parlays, legs)` arrays and emits a `CalibrationReport`:
- Signal tier drift (compare current `SIGNAL_TIER_S/A/B` from `config.ts` vs observed hit rate, min n=50)
- Watchlist promotions (signals that crossed n=50 with ≥60% hit rate)
- New blacklist candidates (n≥50, hit <50%)
- NBA prop × side whitelist/blacklist crossings (n≥20)
- Strategy kill candidates (n≥15, negative net)
- Strategy share nudges (±3% toward observed ROI winners)
- Month-over-month drift warnings (≥10pp swing, min n=20/month)

Output is **advisory only** — it never mutates `config.ts`. The report is returned as JSON for review.

**3. Edge function** — `supabase/functions/parlay-engine-v2-backtest/index.ts`

```text
POST /parlay-engine-v2-backtest
body: {
  date_start: "YYYY-MM-DD",
  date_end:   "YYYY-MM-DD",
  mode:       "backtest" | "calibrate" | "both",   // default "both"
  run_name?:  string,
  dry_run?:   boolean,                              // default true
  options?:   { strict_void_mode?, strict_confidence_mode?, apply_exposure_caps? }
}
```

Flow:
1. Pull historical parlays from `bot_daily_parlays` where `parlay_date` ∈ [start, end]. Each row's `legs` jsonb is unpacked into `CandidateLeg`-shaped objects (best-effort field mapping; missing fields → null with `strict_*_mode` deciding whether to reject or pass).
2. If `mode` includes `"backtest"` → call `replayParlays(...)` and produce the `BacktestReport`.
3. If `mode` includes `"calibrate"` → call `calibrate(...)` and produce the `CalibrationReport`.
4. If `dry_run = false` → write summary to `backtest_runs` and per-parlay outcomes to `backtest_parlay_results` (both tables already exist and have the right columns: `total_parlays_built`, `parlay_win_rate`, `picks_blocked_by_edge`, `config` jsonb for the full report, etc.). `builder_version` = `'parlay_engine_v2.1'`.
5. Return `{ run_id, backtest_report, calibration_report }`.

**4. Field mapping from `bot_daily_parlays.legs` → `CandidateLeg`**

The engine needs ~15 fields per leg. From the historical jsonb we have most of them. For the ones we don't, defaults are explicit:

| CandidateLeg field | Source | Fallback |
|---|---|---|
| `sport`, `player_name`, `team`, `opponent`, `prop_type`, `side`, `line`, `american_odds`, `confidence`, `signal_source` | leg jsonb | — |
| `projected`, `edge` | leg jsonb | derive `edge = projected - line` if missing |
| `tipoff` | leg jsonb `commence_time` if present | parlay `created_at + 6h` (so freshness gate doesn't blanket-reject) |
| `projection_updated_at` | parlay `created_at` | — |
| `line_confirmed_on_book` | leg `is_active` if present | `true` (historical parlays were shipped → line existed) |
| `player_active` | leg `player_active` if present | `true` (same logic; if it had been DNP, parlay would be voided) |
| `defensive_context_updated_at` | not stored | `null` (gate skipped, matches Phase A behavior) |

`strict_void_mode = true` means: any parlay with `outcome = 'void'` is automatically counted as "v2 would have rejected via freshness gate" without re-running filters. This matches `STRATEGY.md § Backtest`: v2 ships ~0% void rate by design.

**5. Tests** — `supabase/functions/parlay-engine-v2-backtest/__tests__/backtest.test.ts`

5 deterministic tests (per testing-policy):
1. `replayParlays` on a 100-parlay synthetic set with 30 voids returns `void_rate_v2 = 0` under strict mode.
2. `replayParlays` correctly rejects a parlay containing the THREES signal (post-v2.1 blacklist).
3. `ExposureTracker` second pass blocks a 5th parlay containing the same player.
4. `calibrate` flags BIG_ASSIST_OVER hit-rate change of +14pp Feb→Mar as a drift warning.
5. ROI calculation matches spec: a single 3-leg parlay at +400 odds with `outcome='won'` and `simulated_stake=1` produces `profit = 4`, `roi = 400%`.

### What this step does NOT do

- No new tables (`backtest_runs` and `backtest_parlay_results` already exist with compatible columns)
- No cron, no scheduling — manual `invoke()` only
- No mutation of `config.ts` from calibration output (advisory only, per spec § 9)
- No Telegram, no broadcasts
- No frontend UI yet (a follow-up phase can add a `/admin/backtest` page that lists `backtest_runs` and renders the JSON report)

### How you'd use it

```ts
// Replay Feb–Mar 2026 through v2 rules, write results
supabase.functions.invoke('parlay-engine-v2-backtest', {
  body: {
    date_start: '2026-02-01',
    date_end:   '2026-03-31',
    mode: 'both',
    run_name: 'v2.1 baseline',
    dry_run: false,
  },
});
```

Expected output shape (per README headline numbers):
```json
{
  "backtest_report": {
    "v1_actual":  { "resolved": 1351, "wr": 0.262, "stake": 151000, "profit": 88800, "roi": 0.587 },
    "v2_shipped": { "resolved": 503,  "wr": 0.278, "stake": 64746,  "profit": 65561, "roi": 0.944,
                    "volume_pct": 0.37 },
    "rejection_reasons": { "exposure:combo_already_shipped": 219, "leg_signal_blacklisted:THREES": 163, ... },
    "profit_foregone": 23239,
    "loss_avoided": 47000
  },
  "calibration_report": {
    "tier_changes": [...],
    "drift_warnings": [{ "signal": "ASSISTS", "feb": 0.974, "mar": 0.773, "delta": -0.201 }],
    "kill_candidates": [],
    "share_nudges": []
  }
}
```

### After this lands

- You can replay any date range on demand and see if a config change would have helped or hurt
- Monthly: hit `mode: 'calibrate'` against the trailing 30 days, review the report, edit `config.ts` by hand
- Re-run backtest after each config edit to measure lift (matches the workflow in `STRATEGY.md § 10`)
- Phase C (separate plan, later): tiny admin UI to browse `backtest_runs` + diff two runs

