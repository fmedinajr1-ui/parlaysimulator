# Court.Edge — Tennis Model Fix, Pass 1

Scope: stop the bleeding from STRONG_OVER, verify the parser hypothesis with real data, and stand up the diagnostic view that will gate any multiplier changes later. CLV tracking and multiplier review ship in pass 2.

## 1. Suppress STRONG_OVER at generation + broadcast

In the Court.Edge run/generator, intercept any pick whose verdict resolves to `STRONG_OVER`:

- Do not write it as an active pick visible to the digest, Telegram, or accuracy dashboard.
- Insert into a new `court_edge_suppressed_picks` table with the full pick payload plus `reason = 'strong_over_disabled_v1'` and `suppressed_at`.
- Still allow the settler to grade these (see step 4) so the bias audit retains the residual signal — they just never count toward headline ROI or get broadcast.

Telegram digest counter (`Leans N · Pass 0 · Quarantine N`) gains a `Suppressed N` field so it's visible the gate is doing work.

## 2. Parser diff backfill (verify before patching)

Before changing `parseRecentRows` / `sumSets`, prove the bug exists:

- Add a one-shot edge function `court-edge-parser-diff` that re-parses every graded pick's source row with a candidate parser (strips `(N)` tiebreak parentheticals defensively + treats any "set" with total games > 13 as a super-tiebreak = 1 game) and compares `actual_total_games` against the stored value.
- Output: count of picks whose grade would change, list of changed picks, and whether the WIN/LOSS flips.
- Decision rule:
  - If ≥ 5% of graded picks change → ship the patched parser + re-grade backfill.
  - If < 5% → leave parser alone, document the audit, move on. (Current regex already anchors with `^` so the `(N)` case is likely already handled — super-tiebreak is the only real risk.)

Either outcome is captured in a short note appended to `mem://logic/betting/tennis-data-sync`.

## 3. `projection_bias_audit` view

SQL view over `court_edge_picks` where `graded = true AND result IN ('WIN','LOSS')` (VOID and ungraded excluded; suppressed STRONG_OVER picks INCLUDED so the residual is visible):

Columns per row: dimension name, bucket, n, mean_residual (`projection - actual_total_games`), win_rate.

Dimensions:
- surface (clay / hard / grass / indoor)
- verdict (4 buckets)
- sets format (bo3 / bo5)
- role combo (home_fav / home_dog / away_fav / away_dog) — derived from `formula.role_adj_*` sign
- edge band (15%+, 10–15%, 7–10%, <7%)
- tournament tier (reuse `tierFromTournament` helper from the dashboard)

The dimension with the largest positive `mean_residual` at `n ≥ 30` is the suspect multiplier and the input to pass 2.

## 4. Admin dashboard updates

On `/admin/court-edge-accuracy`:

- New top card: **v1 vs v2 ROI** side by side. v1 = all graded picks (legacy). v2 = graded picks excluding STRONG_OVER. Same for hit rate and sample size.
- New section: **Projection bias** — render rows from `projection_bias_audit`, sorted by `|mean_residual|` desc, with sample size and a color cue (red if `mean_residual > +0.4` and `n ≥ 30`).
- New section: **Suppressed picks (last 7d)** — count, plus a small table of the most recent 10 with what they would have done if graded.

## 5. Settler tweak

`court-edge-settle` extended to also pick up rows from `court_edge_suppressed_picks` and grade them in place (writes `result` / `actual_total_games` / `settled_at` on the suppressed row, not the main table). This is what feeds the bias audit's STRONG_OVER bucket.

## Explicitly out of scope for pass 1

- CLV / closing-line capture and columns
- Any change to `surface_mult`, `role_adj`, `spread_adj`, or other projection multipliers
- New tennis markets (set totals, game spreads, player props)
- Verdict threshold changes (STRONG vs LEAN cutoffs)
- Changes to `gradeVerdict` — confirmed correct, bug is upstream

## Acceptance criteria

- [ ] After deploy, zero new rows in `court_edge_picks` with `verdict = 'STRONG_OVER'`; corresponding row exists in `court_edge_suppressed_picks` for each blocked emission.
- [ ] Telegram digest shows a `Suppressed N` count.
- [ ] `court-edge-parser-diff` run completes and returns a JSON report with `changed_count`, `flipped_count`, and per-pick deltas; decision logged.
- [ ] `projection_bias_audit` view returns rows for every dimension with sample sizes; visible on the admin page.
- [ ] Admin page renders v1 vs v2 ROI side by side and the suppressed-picks tile.
- [ ] Settler updates suppressed rows so STRONG_OVER residuals appear in the bias audit.

## Technical notes

- New tables: `court_edge_suppressed_picks` (mirrors `court_edge_picks` columns + `reason`, `suppressed_at`, plus settler fields). Service role only; admin-only RLS via `has_role(auth.uid(), 'admin')`.
- New view: `projection_bias_audit` (security_invoker, admin-readable).
- New edge function: `court-edge-parser-diff` (one-shot, admin-invoked).
- Edited: `court-edge-run` (or wherever verdict is finalized + broadcast), `court-edge-settle`, `src/pages/admin/CourtEdgeAccuracy.tsx`.
- Memory update: append a "STRONG_OVER suppressed pending bias audit" note to `mem://logic/betting/tennis-data-sync`.
