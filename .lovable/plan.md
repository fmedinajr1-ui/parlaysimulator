## Phase 1 — Edge Calculation (devigged probability edge)

Scope is **Phase 1 only**. Phases 2–5 follow as separate plans.

### What's wrong today
`edgeFor()` in `_shared/court-edge-projection.ts` returns `(projection − line) / line × 100`. That's projection distance, not edge — which is why we're seeing +35% / +48% numbers. There's also no over/under price devigging anywhere; `court-edge-fetch-odds` throws away over/under prices and only keeps `total_point` from the first book.

### Changes

**1. `_shared/court-edge-edge.ts` (new)** — pure helpers:
- `americanToImplied(odds)` and `devigPair(over, under)` (normalize so they sum to 1).
- `modelProbOver(projection, line, sigma)` — uses Abramowitz normal CDF copied locally (no cross-package import from `src/lib`).
- Sigma constants:
  ```ts
  export const SIGMA_GAMES = { wta_bo3: 3.5, atp_bo3: 4.0, wta_bo5: 4.5, atp_bo5: 5.5 };
  export function pickSigma(tour: 'wta'|'atp'|'unknown', sets: 'bo3'|'bo5'): number;
  ```
- `EDGE_HARD_CAP_PP = 0.12`.

**2. Rewrite `edgeFor` in `_shared/court-edge-projection.ts`**
New return shape:
```ts
{
  reference, model_prob_over, model_prob_under,
  vig_free_implied_over, vig_free_implied_under,
  edge_pp,             // signed: + = OVER, − = UNDER, in probability points
  edge_side: 'over'|'under'|'none',
  verdict,             // includes new 'QUARANTINE'
  quarantine_reason?
}
```
- Both prices present → devig → `edge_pp = model_prob_side − devigged_implied_side` for the favored side.
- Either price missing → `edge_side: 'none'`, `verdict: 'PASS'` (no fake edges).
- `|edge_pp| > 0.12` → `verdict: 'QUARANTINE'`, reason `edge_above_hard_cap`.
- Otherwise (Phase 1 placeholder thresholds, Phase 4 will refine):
  - `≥ 0.04` → STRONG_OVER / STRONG_UNDER
  - `≥ 0.02` → LEAN_OVER / LEAN_UNDER
  - else PASS

**3. Add `QUARANTINE` to the `Verdict` union** and update `court-edge-projection_test.ts` boundary asserts.

**4. `court-edge-fetch-odds/index.ts`** — capture both prices and book counts:
- Add `total_over_price`, `total_under_price` to `NormalizedEvent`.
- Per the user's call: collect **all bookmakers** with totals on each event into a `book_lines: Array<{book, point, over_price, under_price}>` and a `books_count`. The orchestrator continues to use the primary `total_point` for now; `book_lines` is captured for Phase 4 multi-book agreement.

**5. `court-edge-run/index.ts`** — plumbing:
- Pick `sigma` via `pickSigma(tour, sets)`; derive `tour` from `sport_key` prefix (`tennis_atp_*` vs `tennis_wta_*`), default `'unknown'` → `wta_bo3`.
- Replace both `edgeFor(...)` call sites with the new signature, passing `over_price`, `under_price`, `sigma`.
- Persist new fields on each Pick: `model_prob`, `vig_free_implied`, `edge_pp`, `edge_side`, `quarantine_reason`, `books_count`, `book_lines`. Keep legacy `edge`/`edge_pct` columns populated (`edge_pct = edge_pp * 100`) so existing dashboards don't break — values now mean **percentage points**, not relative %.
- Picks with `verdict === 'QUARANTINE'` are inserted into `court_edge_picks` for audit but excluded from the Telegram digest.

**6. Telegram label tweak** — one line in `buildDigest`: `edge {sign}{(edge_pp*100).toFixed(1)}pp` instead of `fmtPct(edge_pct)`. No other UI/styling changes.

**7. Tests** (`_shared/court-edge-edge_test.ts`, 5 per testing-policy):
1. `americanToImplied(-110)` ≈ 0.5238.
2. `devigPair(-110, -110)` → `{ 0.5, 0.5 }`.
3. `modelProbOver(22, 20, 3.5)` between 0.5 and 0.99.
4. `edgeFor(projection=22, line=20.5, -110/-110, σ=3.5)` → `|edge_pp| < 0.12`, verdict LEAN_OVER or PASS.
5. `edgeFor(projection=30, line=20, -110/-110)` → verdict `QUARANTINE`, reason `edge_above_hard_cap`.

### Files Touched
- `supabase/functions/_shared/court-edge-edge.ts` (new)
- `supabase/functions/_shared/court-edge-edge_test.ts` (new)
- `supabase/functions/_shared/court-edge-projection.ts` (rewrite `edgeFor`, add QUARANTINE)
- `supabase/functions/_shared/court-edge-projection_test.ts` (update boundary tests)
- `supabase/functions/court-edge-fetch-odds/index.ts` (capture all books + over/under prices)
- `supabase/functions/court-edge-run/index.ts` (plumb new args + fields, gate digest)

### Out of scope (future phases)
- Projection model fixes / blowout suppression / hold-rate priors / sanity bounds (Phase 2)
- Tournament tagging + calibrated_tiers + line range filter (Phase 3)
- Tier promotion rules: ≥2 books agree, weather present, etc. (Phase 4)
- Diagnostics line + header counts + 20% quarantine warning (Phase 5)

### Deliverable after switching to default mode
Diff for the 6 files, a one-paragraph summary, and a list of picks from the most recent `court_edge_runs` row that would now be QUARANTINEd or downgraded under the new math. Then I stop and wait before touching Phase 2.
