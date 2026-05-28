## Goal

Stand up the new Court.Edge spec (multiplicative surface/sets mults, relative-% edge, BACK/FADE/PASS verdicts, weak-fit gating, ATP-GS-only bo5 classifier) as **v3 in parallel** with the current Phase 2/3 engine (priors + Bayesian shrink + devigged edge + STRONG/LEAN verdicts). Both run on every match; v3 writes to shadow columns/rows so we can A/B against current production before flipping.

Also add a real per-surface fit signal so the weak-fit gate has something to bite on.

---

## 1. New v3 projection module (pure, tested)

Create `supabase/functions/_shared/court-edge-projection-v3.ts` implementing the spec **verbatim**:

- Constants block: `WEIGHTS_L3 = [0.5, 0.3, 0.2]`, `SURFACE_MULT = { clay:1.00, hard:1.00, grass:0.97 }`, `SETS_MULT = { bo3:1.00, bo5:1.47 }`, `SPREAD_ADJ_PER_10_AM_GAP = 0.30`, weather thresholds (30°C / 25 kph), `INDOOR_ADJ = +0.20`, fit thresholds (0.55 weak / 0.75 strong) with ±0.20 / ±0.15 per-player, `EDGE_BACK_THRESHOLD = +0.08`, `EDGE_FADE_THRESHOLD = −0.08`, `WEAK_FIT_GATE_COUNT = 2`.
- `resolveSetsFormat(tour, tier)` → `bo5` only for ATP Grand Slams, else `bo3`. Map our existing `TournamentTier` (`grand_slam`, `masters_1000`, …) to the spec's tiers internally — no new tier strings.
- `weightedL3(games)` returns `null` if fewer than 3 entries or any null (matches spec — stricter than current `weightedL3` which renormalises).
- `spreadAdjV3(mlFav, mlDog)` — exact spec formula on absolute American-odds gap, sign convention: closer match = positive, blowout = negative (we'll calibrate sign empirically in audit; default to spec).
- `weatherAdjV3` in **°C and kph** (current engine uses °F/mph — convert at call site).
- `projectV3(input)` returns `{ projection, sets_format, base_l3, surface_mult, sets_mult, spread_adj, weather_adj, indoor_adj, p1_role_adj, p2_role_adj, weak_fit_count }`.
- `edgePctV3 = (projection − line) / line` (signed relative %, not probability points).
- `verdictV3(edgePct, weak_fit_count)` returns `BACK_OVER | FADE_OVER | PASS` plus `pass_reason` when the weak-fit gate downgrades a non-PASS verdict.

Add `court-edge-projection-v3_test.ts` with **5 tests** (per project core rule):
1. `resolveSetsFormat` — ATP+GS → bo5; WTA+GS → bo3; ATP+M1000 → bo3.
2. `weightedL3` — exact 0.5/0.3/0.2 weighting; returns null on short/sparse input.
3. `projectV3` — known inputs hit expected projection within 0.01.
4. `verdictV3` — boundary edges at +0.08 / −0.08 / +0.079 / weak-fit gate downgrade with reason.
5. Spread-adj sign + weather/indoor stacking sanity.

No changes to existing `court-edge-projection.ts`, `court-edge-edge.ts`, or `court-edge-prior.ts`.

---

## 2. Per-surface fit field

New column `player_surface_fit` (single source of truth) — table `public.court_edge_player_fit`:

```text
player_slug TEXT, surface TEXT ('clay'|'hard'|'grass'),
fit NUMERIC(4,3),                 -- [0,1]
fit_n INT,                        -- sample size used
computed_at TIMESTAMPTZ DEFAULT now(),
PRIMARY KEY (player_slug, surface)
```

GRANTs: `service_role` ALL; `authenticated` SELECT (read-only for dashboards). RLS on; single SELECT policy `USING (true)`.

Backfill helper (separate edge function, not in this plan's scope to deploy — stub only): computes `fit` from L3+L10 surface-specific game totals normalised against the surface prior μ (z-score → squashed to [0,1] with a logistic). For v3's first run, we'll seed `fit = 0.65` (neutral) for any player without a row so the weak-fit gate stays inert until backfill lands.

Loader in v3 path: batched `SELECT player_slug, fit WHERE surface = $1 AND player_slug = ANY($2)`; missing rows default to 0.65.

---

## 3. Shadow write from `court-edge-run`

In `supabase/functions/court-edge-run/index.ts`, immediately after every existing `project(...) + edgeFor(...)` block (both match_total at line ~369 and player_total_games at line ~459):

1. Build the v3 input from the same source data (convert temp °F → °C, wind mph → kph, fetch the two surface-fit values).
2. Call `projectV3` + `verdictV3`.
3. Stash the v3 result on the pick row under a new JSONB column `v3_shadow` (added in the migration below). No row duplication, no extra inserts.

`court_edge_picks` migration adds:

```text
v3_shadow JSONB
```

(Nullable, no default. Single ALTER, no GRANT change needed.)

The live `verdict`, `edge`, `projection` columns continue to be populated by the current engine — v3 is **shadow only** for this phase.

---

## 4. Audit view

Create view `public.court_edge_v3_audit` joining `court_edge_picks` rows where `v3_shadow IS NOT NULL AND graded = true`, exposing:

- `id, run_id, market, line, commence_at, actual_total_games, result`
- live: `projection, edge_pct, verdict, suppressed`
- v3: `v3_shadow->>'projection', v3_shadow->>'edge_pct', v3_shadow->>'verdict', v3_shadow->>'pass_reason'`
- residuals: `actual - projection` for both engines
- agreement flag: `live_dir == v3_dir`

Used later by `/admin/court-edge-accuracy` to compare hit-rate / mean-residual / CLV side-by-side before any flip decision.

---

## 5. Card / Telegram display

No changes in this plan. The card still renders the live engine. We add a follow-up plan to surface v3 alongside live (or behind a `?engine=v3` query param) once the audit view shows at least 14 days of parallel data.

---

## 6. Out of scope (explicit)

- No edits to current `project()`, `edgeFor()`, priors, or tier thresholds.
- No flip of the live verdict to v3.
- No surface-fit backfill job (stub seed only; backfill is a follow-up).
- No UI changes to the Lovable card or Telegram messages.

---

## Technical details

**Files added**
- `supabase/functions/_shared/court-edge-projection-v3.ts`
- `supabase/functions/_shared/court-edge-projection-v3_test.ts`
- `supabase/functions/_shared/court-edge-fit.ts` (loader for `court_edge_player_fit`)

**Files edited**
- `supabase/functions/court-edge-run/index.ts` — two shadow-write blocks + fit batch fetch at run start.

**Migration**
- `CREATE TABLE public.court_edge_player_fit (...)` + GRANTs + RLS + read-all policy.
- `ALTER TABLE public.court_edge_picks ADD COLUMN v3_shadow JSONB`.
- `CREATE VIEW public.court_edge_v3_audit AS ...` (GRANT SELECT TO authenticated, service_role).

**Risk**: Zero to live picks — v3 is write-only-to-shadow. Only failure mode is the v3 shadow write throwing; wrapped in try/catch with `console.warn('[v3 shadow]', err)` so it never blocks the live pipeline.

**Acceptance**
- 5 v3 unit tests pass.
- Next `court-edge-run` execution populates `v3_shadow` on every inserted pick.
- `court_edge_v3_audit` returns rows after the next settlement cycle.
