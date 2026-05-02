# RBI Unders rebuild — 4-variant bake-off + settlement tracking

## Why this plan

- `mlb_rbi_under_analysis` last wrote on **2026-04-11**; no edge function in repo writes to it (analyzer was deleted).
- No `0.6 / L3` threshold exists in DB or code — your memory of it can't be confirmed, so we'll **test all four candidate gates side-by-side** and let real settled results decide the winner.
- `mlb_engine_picks` has no `result` column — we can't grade history. Adding one now so the next bake-off is data-driven.

## What I'll build

### 1. Schema changes (migration)
- `mlb_rbi_under_analysis`: add `variant text`, `line numeric`, `p_under numeric`, `edge numeric`, `expected_rbi numeric`, `l3_rbis numeric`, `l3_rbis_per_pa numeric`, `reason text`, `result text` (`WIN|LOSS|VOID|PENDING`), `actual_rbis integer`, `settled_at timestamptz`. Index `(analysis_date, variant, tier)`.
- `mlb_engine_picks`: add `result text` default `'PENDING'`, `actual_value numeric`, `settled_at timestamptz`. Index `(prop_type, side, result)`.

### 2. Shared model — `_shared/mlb-rbi-under-model.ts`
Core Poisson scorer used by all variants:
- `expected_RBI = batter_RBI_per_PA_blended * expected_PA * pitcher_quality_mult * park_RBI_mult * lineup_spot_mult`
- `pUnder = poissonCDF(floor(line), expected_RBI)`
- Universal hard blocks: Coors Field, batter L10 RBI/PA > 0.18 AND lineup spot 3–5.

### 3. Four variants (run in parallel each scan)
| Variant | L3 gate | Other gates |
|---|---|---|
| **A** | L3 RBI/PA ≤ 0.06 | pUnder ≥ 0.66, edge ≥ 5% |
| **B** | L3 total RBIs ≤ 0.6 | pUnder ≥ 0.66, edge ≥ 5% |
| **C** | none (Bayesian only) | pUnder ≥ 0.68, edge ≥ 5% |
| **D** | L3 RBIs ≤ 1 AND pUnder ≥ 0.68 | edge ≥ 5% |

Each candidate batter is scored once, then tagged with **every variant it passes**. One row per (player, variant) so a single hitter can appear under A, B, and D simultaneously and we get clean per-variant accuracy.

Tiers within each variant:
- **S**: pUnder ≥ 0.74 AND edge ≥ 8%
- **A**: meets variant min only

### 4. New edge function — `mlb-rbi-under-analyzer/index.ts`
- Pulls today's lineups + probable pitchers from existing MLB ingestion tables.
- Pulls `batter_rbis` Under lines from `unified_props`; falls back to The Odds API `event-odds` (same pattern as `mlb-pitcher-k-analyzer`).
- Computes L3 stats from `mlb_player_game_logs`.
- Name-normalize (NFD + suffix strip).
- Inserts one row per (player × variant-passed) into `mlb_rbi_under_analysis`.

### 5. Pick promotion (only winning variants until proven)
- Initially feed `parlay-engine-v2` candidates from **variant C only** (cleanest statistically) so we don't flood broadcasts during the bake-off.
- A/B/D rows still get scored + persisted + settled — they're shadow-tracked for accuracy comparison without going to Telegram.
- After ~7 days I can switch promotion to whichever variant has the best settled win-rate.

### 6. Settlement
- Extend `mlb-over-tracker` to grade both:
  - `mlb_rbi_under_analysis` rows → `result`, `actual_rbis`, `settled_at`.
  - `mlb_engine_picks` rows where `prop_type='batter_rbis'` → `result`, `actual_value`, `settled_at`.
- Under wins when actual RBIs ≤ floor(line); VOID on DNP.

### 7. Cron
- Insert (not migration — contains URL/anon key) a `pg_cron` job: `mlb-rbi-under-analyzer` at **11:05 AM ET** and **3:05 PM ET**.

### 8. Accuracy view
- Create view `mlb_rbi_under_variant_accuracy` exposing per-variant: `picks`, `wins`, `losses`, `voids`, `win_rate`, `last_7d_win_rate`. So you (and I) can run one query and see which gate is winning.

### 9. Tests (5, per project rule)
1. Cold 8-hole batter vs ace pitcher → passes A, C, D.
2. Hot 4-hole batter vs weak pitcher → universal hard-block.
3. Coors Field game → universal hard-block.
4. Borderline pUnder=0.65, edge=4% → kept by none.
5. Missing `unified_props` line → Odds API fallback returns line, scoring proceeds.

### 10. Memory
- Update `mem://logic/betting/mlb-rbi-system` to document the 4-variant bake-off, settlement, and "promote variant C first" decision.
- Refresh `mem://index.md` line.

## Files
- new: `supabase/functions/_shared/mlb-rbi-under-model.ts` + `_test.ts`
- new: `supabase/functions/mlb-rbi-under-analyzer/index.ts`
- edit: `supabase/functions/mlb-over-tracker/index.ts`
- edit: `supabase/functions/parlay-engine-v2/index.ts` (variant C promotion)
- new migration: schema columns + accuracy view
- insert (separate): cron schedule
- edit: `mem/logic/betting/mlb-rbi-system.md`, `mem/index.md`

Out of scope: RBI Overs (still suppressed), HRB analyzers (untouched).

Approve and I'll build.