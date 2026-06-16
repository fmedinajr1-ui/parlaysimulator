
# Full rewrite to the new ParlayIQ engine

The uploaded zip ships a brand-new parlay-engine API (`generateParlayTickets`, `scoreLeg`, `LegInput`, `ScoredLeg`, `ParlayTicket`) that replaces the old class-based engine (`ParlayEngine`, `CandidateLeg`, `Parlay`, `ExposureTracker`, etc.). The two new entry-point functions in the zip (`cross-sport-parlay-generator`, `cross-sport-sweet-spots`) are the reference wiring.

## What changes

### 1. Replace shared engine
Overwrite the 12 files in the zip:
- `supabase/functions/_shared/parlay-engine-v2/`: `config.ts`, `models.ts`, `scoring.ts`, `correlation.ts`, `kelly.ts`, `filters.ts`, `dedup.ts`, `strategies.ts`, `index.ts`, `README.md`
- `supabase/functions/cross-sport-parlay-generator/index.ts`
- `supabase/functions/cross-sport-sweet-spots/index.ts`

### 2. Delete obsolete modules (incompatible with new API)
- `supabase/functions/_shared/parlay-engine-v2/generator.ts`
- `supabase/functions/_shared/parlay-engine-v2/allocator.ts`
- `supabase/functions/_shared/parlay-engine-v2/backtest.ts`
- `supabase/functions/_shared/parlay-engine-v2/calibration.ts`
- `supabase/functions/_shared/parlay-engine-v2/__tests__/` (old engine.test, v25.test — written against old API)

### 3. Reconnect every caller
Rewrite each consumer to the new `LegInput`/`generateParlayTickets` surface:

| File | Today (old API) | After |
|---|---|---|
| `supabase/functions/parlay-engine-v2/index.ts` | Builds `CandidateLeg[]`, instantiates `new ParlayEngine()`, calls `generateSlate()` | Builds `LegInput[]`, calls `generateParlayTickets({ legs, bankroll, pairLifts })`; persist `ParlayTicket[]` instead of `Parlay[]` |
| `supabase/functions/parlay-engine-v2-backtest/index.ts` + tests | Parses rows into `CandidateLeg` | Parses rows into `LegInput`; re-score historical tickets via `scoreLeg`; replay through `generateParlayTickets` |
| `supabase/functions/parlay-engine-v2-broadcast/index.ts` + tests | Reads `Parlay` shape (legs/stake_units/combined_probability/…) | Reads `ParlayTicket` shape (legs/stake/correlatedProb/ev/parlayEdge/…); update Telegram formatting accordingly |
| `supabase/functions/bot-generate-straight-bets/index.ts` | Imports config/threshold constants from old engine | Re-point to new `config.ts` constants (`MIN_LEG_CONFIDENCE`, `MIN_OVER_L10_HIT_RATE`, `NBA_PROP_WHITELIST`, etc.) |
| `supabase/functions/refresh-l10-and-rebuild/index.ts` | Imports old types | Re-point types to new `LegInput`/`ScoredLeg` |
| `supabase/functions/_shared/direct-pick-sources.ts` | Returns `CandidateLeg[]` | Return `LegInput[]` (rename fields: `player_name`→`player`, `american_odds`→`americanOdds`, `event_id`→`gameId`, `confidence`/`edge`/`signal_tier` mapped to `signalTier`) |
| `supabase/functions/_shared/matchup-xref.ts` | Mutates `CandidateLeg.confidence` via `matchupAdjustment` | Same logic but typed against `LegInput`; field renames as above |

Constants formerly exported from `parlay-engine-v2/config.ts` that the new file does **not** ship (`BOOKMAKER_PRIORITY`, `MAX_BOOK_LINE_AGE_MIN`, `MAX_LINE_DRIFT`, `MAX_TEAM_SPREAD_ABS`, `PROP_WHITELIST`, `PROP_BLACKLIST`) will be relocated to a new `supabase/functions/_shared/pipeline-config.ts` and re-imported from there by the callers that need them, so engine config stays clean.

### 4. Schema / persistence
`parlay_engine_v2_runs` / `parlay_engine_v2_tickets` (or whatever tables `parlay-engine-v2/index.ts` writes) currently store `Parlay` fields (`combined_probability`, `stake_units`, `adjusted_combined_probability`, `correlation_warnings`). New ticket has `prob`, `correlatedProb`, `stake`, `parlayEdge`, `parlayScore`, `rankingScore`. Migration plan:
- Add new nullable columns matching the new shape.
- Backfill writers to populate both old + new for one pipeline run.
- Switch readers (Telegram broadcast, UI hooks) to new columns.
- Drop old columns in a follow-up once nothing reads them.

### 5. Redeploy
Deploy in this order so nothing is half-rewired:
1. `_shared/parlay-engine-v2/*` (no deploy — picked up by functions)
2. `cross-sport-parlay-generator`, `cross-sport-sweet-spots`
3. `parlay-engine-v2`, `parlay-engine-v2-backtest`, `parlay-engine-v2-broadcast`
4. `bot-generate-straight-bets`, `refresh-l10-and-rebuild`, plus any function that imports `direct-pick-sources` / `matchup-xref`

### 6. Tests (per Core memory: 5 independent tests for any new pipeline)
Add `supabase/functions/_shared/parlay-engine-v2/__tests__/engine.test.ts` covering:
1. `scoreLeg` produces correct safety tier for a known L10/hit-rate fixture.
2. `generateParlayTickets` respects `MAX_SAME_GAME_SHARE` (0.75) and `MIN_DISTINCT_GAMES` (2).
3. NBA prop whitelist suppresses non-whitelisted props.
4. Correlation `pairLifts` reduce `correlatedProb` vs raw `prob`.
5. Kelly-lite sizer caps stake at `STAKE_BY_TIER` × confidence mult ≤ 2.0.

## Out of scope
- No UI changes. Frontend hooks that read parlay rows keep working once the new column names are aliased in the readers.
- No new sports. Same sport coverage as today.
- No Telegram template redesign — only field-name swaps.

## Risk
Large blast radius — every pipeline function that touches parlays gets rewritten. Plan to land it behind a single PR-style batch with the test suite green before redeploying the cron-triggered functions (`parlay-engine-v2`, `bot-generate-straight-bets`, `refresh-l10-and-rebuild`).
