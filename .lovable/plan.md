

## Phase A: Port Parlay Engine v2 to a TypeScript edge function (no scheduling, no Telegram)

This is the **pure generator core**, ported 1:1 from your Python spec. It reads a candidate-leg pool from Supabase, runs the v2 strategies/filters/exposure caps, and writes parlays to `bot_daily_parlays`. Nothing else: no cron, no Telegram, no settlement, no auto-trigger. You'll be able to run it on demand via `supabase.functions.invoke('parlay-engine-v2', { body: { dry_run: true } })` and inspect the output before we wire any of it into the daily flow.

### What gets built

**1. Shared engine library** (`supabase/functions/_shared/parlay-engine-v2/`)

Direct port of your 8 Python files into typed Deno TypeScript modules:

| File | Source |
|---|---|
| `config.ts` | `config.py` — every threshold, allocation, whitelist, blacklist, tier set as `const` exports. ALL values preserved exactly (LEG_COUNT_ALLOCATION, ODDS_BANDS, ACTIVE_STRATEGIES, KILLED_STRATEGIES, SIGNAL_TIER_S/A/B, SIGNAL_WATCHLIST, SIGNAL_BLACKLIST, PROP_WHITELIST, PROP_BLACKLIST, MIN_LEG_CONFIDENCE 0.65, MAX_DAILY_DUPLICATION_RATIO 0.05, MAX_SAME_PLAYER_EXPOSURE 4, MAX_SAME_GAME_EXPOSURE 8, VOID_GUARDS, STAKE_BY_TIER, SPORT_ALLOCATION). |
| `models.ts` | `models.py` — `CandidateLeg`, `Parlay`, `GenerationReport` interfaces + helper functions for `decimalOdds`, `impliedProb`, `fingerprint`, `comboHash`, `combinedDecimalOdds`, `combinedAmericanOdds`, `combinedProbability`, `expectedValueUnits`, `avgLegConfidence`. |
| `scoring.ts` | `scoring.py` — `legQualityScore`, `rankLegs`, `parlayEvScore`, `parlayRankingScore` (with the FAT_PITCH 1.15x bonus and S/A signal-concentration bonus). |
| `filters.ts` | `filters.py` — `legIsBettable`, `legPassesSignalGate`, `legPassesPropGate`, `validateLeg`, `parlayWithinOddsBand`, `parlayEdgeSufficient`, `parlayNoConflictingLegs`, `parlayLegCountValid`, `parlaySameGameConcentration`, `validateParlay`. |
| `dedup.ts` | `dedup.py` — `ExposureTracker` class with `canAccept`, `accept`, `rejectDuplicate`, `duplicationRatio`, `summary`. |
| `strategies.ts` | `strategies.py` — all 8 strategies (`mispricedEdge`, `grindStack`, `crossSport`, `doubleConfirmed`, `optimalCombo`, `shootoutStack`, `roleStackedLongshot`, `megaLotteryScanner`) + `_bestComboToBand`, `_uniquePlayers`, `_build`, `STRATEGY_REGISTRY`. Seeded RNG ported via mulberry32 for deterministic combo search. |
| `allocator.ts` | `allocator.py` — `slotTargetCount`, `computeDailyPlan`, `tierBankrollShare`, `estimateDailyExposureUnits`. |
| `generator.ts` | `generator.py` — `ParlayEngine` class with `generateSlate(candidates, now)` returning `SlateResult { parlays, report }`. Same loop structure: leg filter → daily plan → per-strategy build with bounded retries → narrow-pool by exposure → `validateParlay` → `exposure.canAccept` → trim/sort by `parlayRankingScore`. |

No external deps. Pure functions + one class. Tree-shakeable.

**2. Edge function** `supabase/functions/parlay-engine-v2/index.ts`

Single endpoint that:

```text
POST /parlay-engine-v2
body: { dry_run?: boolean, date?: "YYYY-MM-DD" }
```

Flow:
1. Load candidate legs from `bot_daily_pick_pool` for today (ET via existing `_shared/date-et.ts`) joined with `unified_props` for `american_odds`, `commence_time`, `sport`, `team`/`opponent` (parsed from `game_description`).
2. Map each row into a `CandidateLeg`:
   - `confidence` ← `confidence_score / 100` (or `composite_score / 100`)
   - `american_odds` ← `over_price` / `under_price` based on `recommended_side`
   - `signal_source` ← `category` from pick_pool, normalized via a small mapping table (e.g. `"three_point_shooter"` → `"THREE_POINT_SHOOTER"`)
   - `projected` ← `projected_value`, `edge` ← `projected - line`
   - `line_confirmed_on_book` ← `unified_props.is_active && over_price IS NOT NULL`
   - `player_active` ← assumed true (we don't have an injury feed wired here yet — flagged in report)
   - `projection_updated_at` ← `bot_daily_pick_pool.created_at`
   - `defensive_context_updated_at` ← null (skip that gate for now, noted in report)
3. Call `engine.generateSlate(candidates, new Date())`.
4. If `dry_run` → return `{ slate_result, mapped_candidates_sample, report }` as JSON, write nothing.
5. If not `dry_run` → insert each parlay into `bot_daily_parlays` with:
   - `strategy_name` = `parlay.strategy`
   - `tier` = `parlay.tier` (CORE/EDGE/LOTTERY)
   - `legs` = jsonb array of legs (player_name, prop_type, line, side, american_odds, sport, confidence, signal_source)
   - `leg_count`, `combined_probability`, `expected_odds` = combined American
   - `simulated_stake` = `parlay.stake_units`, `simulated_edge`, `selection_rationale` = `parlay.rationale`
   - `outcome` = `'pending'`, `is_simulated` = true
   - `parlay_date` = today ET
6. Return `{ inserted, report }`.

**3. Tests** — `supabase/functions/parlay-engine-v2/__tests__/engine.test.ts`

5 deterministic unit tests (per your testing-policy rule):
1. `legQualityScore` ranks an S-tier whitelist leg above a B-tier non-whitelist leg with same confidence.
2. `validateLeg` rejects a leg with stale projection (>120 min) and accepts one fresh.
3. `ExposureTracker` blocks a 5th parlay containing the same player.
4. `mispricedEdge` returns null when no NBA whitelist legs meet 0.70 confidence; returns a 3-leg parlay when they exist.
5. `generateSlate` on a synthetic 200-leg pool produces parlays whose strategy/tier mix matches `LEG_COUNT_ALLOCATION` within ±1, and `combo_hash` uniqueness ≥95%.

### What this step does NOT do

- No cron job, no scheduling
- No Telegram message, no broadcast
- No settlement / outcome verification
- No auto-trigger from any other function
- No changes to existing `bot_daily_pick_pool` writers
- No Lovable AI calls
- No frontend UI changes (existing `useBotPipeline` hook keeps working — it just reads whatever this writes when you trigger it)

### Open mapping decisions (shipping with these defaults; trivial to change later)

- **Signal source mapping**: `bot_daily_pick_pool.category` strings will be uppercased and normalized (e.g. `"three_point_shooter"` → `"THREE_POINT_SHOOTER"`). Anything that doesn't match `SIGNAL_TIER_S/A/B/WATCHLIST` lands in the "unknown" bucket and gets the 0.90x penalty per `scoring.py`.
- **Defensive-context gate**: skipped on first run (we don't have a single canonical `defense_updated_at` column). Will return to add this gate once we pick a source table.
- **Player active gate**: currently always true. Easy to wire to an injuries table later if you have one.
- **Stake → dollars**: kept as units only in DB (`simulated_stake`). Conversion to $ happens outside the engine.

### After this lands

You'll be able to:
1. Hit the function manually from the Supabase dashboard or via `invoke()` to dry-run today's slate
2. Inspect the `GenerationReport` (rejection reasons, strategy breakdown, tier breakdown, duplication ratio)
3. Promote the run to a real insert when satisfied
4. In a later phase we wire it to a daily cron + Telegram broadcast + settlement loop (separate plans)

