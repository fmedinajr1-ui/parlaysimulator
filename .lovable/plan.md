## Phase 2 — Projection Model Fixes

Scope is **Phase 2 only** (model + projection math). Phase 1's edge-calc layer stays untouched. Data ingestion (`court-edge-fetch-odds`, `scrape-l3`, `fetch-weather`) is also untouched per your rule.

### What's wrong today (in `_shared/court-edge-projection.ts`)

1. **Structural OVER bias.** `base * surfaceMult * setsMult` multiplies an L3 average that already includes those effects, then the additive blowout/weather/role adjustments are too small to pull it back. Result: projection systematically > line.
2. **No blowout suppression.** A 6‑0 6‑1 (13 games) and a 7‑6 6‑4 (23 games) get equal weight in L3. Recent blowouts inflate the variance but the mean stays normal — except when the *next* match is also between mismatched players. We need an explicit favorite‑heaviness penalty on top of `spreadAdj`.
3. **`spreadAdj` is too weak and one-sided.** `-2.5 * |nH − nA|` caps at ~‑2.5 games even for a 90/10 favorite, and never *adds* games for true coin flips. A 50/50 should bias slightly OVER (more competitive sets).
4. **No hold-rate prior.** Two big servers on grass should pull projection UP independently of L3; two returners on clay should pull DOWN. Roles partially do this but only as a small additive — there's no Bayesian shrink to a surface/tour-specific prior, so noisy 3-match samples dominate.
5. **No sanity bounds.** Output can be 11.5 or 35.0 games on a Bo3, which is physically impossible and silently passes through into edge-calc, which then trips QUARANTINE — masking the real bug.

### Changes (all in `_shared/court-edge-projection.ts` + new prior file)

**1. New: `_shared/court-edge-prior.ts`** — pure data, no I/O.
```ts
// Match-total game priors (mean + sd) by surface × sets × tour.
// Derived from long-run pro-tour averages; same source family as baseline.ts.
export const MATCH_TOTAL_PRIOR = {
  bo3: {
    atp: { hard: {mu: 22.0, sd: 3.6}, clay: {mu: 21.4, sd: 3.4}, grass: {mu: 22.6, sd: 4.0}, indoor: {mu: 21.8, sd: 3.6} },
    wta: { hard: {mu: 20.8, sd: 3.4}, clay: {mu: 20.4, sd: 3.3}, grass: {mu: 21.0, sd: 3.8}, indoor: {mu: 20.6, sd: 3.4} },
  },
  bo5: {
    atp: { hard: {mu: 35.0, sd: 5.5}, clay: {mu: 34.0, sd: 5.2}, grass: {mu: 36.0, sd: 6.0}, indoor: {mu: 34.6, sd: 5.4} },
    wta: { hard: {mu: 35.0, sd: 5.5}, clay: {mu: 34.0, sd: 5.2}, grass: {mu: 36.0, sd: 6.0}, indoor: {mu: 34.6, sd: 5.4} },
  },
} as const;

export function priorFor(tour, sets, surface): {mu:number; sd:number}; // unknown → wta/hard fallback
```

**2. Rewrite `project()` math** (same signature, new internals):

a. **Drop the multiplicative `surfaceMult * setsMult` stack.** Surface and sets effects are now expressed *only* through the prior (`mu_prior`). The L3 average becomes a player-skill delta, not a re-multiplied base.
```
delta_l3   = ((w1 + w2) / 2)  −  prior.mu / 2     // each player's contribution vs prior half
combined   = prior.mu + 2 * delta_l3              // recompose around prior mean
```

b. **Bayesian shrink toward the prior** (kills 3-match noise + the OVER-bias compounding):
```
n_eff = (count(p1_l3) + count(p2_l3))             // up to 6
k     = 4                                          // shrink strength (4 "virtual matches")
shrunk = (n_eff * combined + k * prior.mu) / (n_eff + k)
```

c. **New `spreadAdjV2`** — two-sided, capped harder, applied AFTER shrink:
```
diff = |nH − nA|                                  // 0..1
if (diff < 0.10)  adj = +0.6                      // true coin flips → slight OVER
else              adj = -3.0 * (diff - 0.10) / 0.40   // linear, capped at −3.0 by diff=0.50
clamp adj to [-3.0, +0.8]
```
Replaces the existing `spreadAdj`. Old `spreadAdj` export kept as alias for tests but unused by `project()`.

d. **Blowout-recency penalty.** If either player's most-recent match total is ≤ 14 games (Bo3) or ≤ 22 (Bo5), subtract 0.5 games — that's a recent blowout flagging a likely repeat in form mismatch.
```
blowout_adj = 0
const cutoff = sets_format === 'bo5' ? 22 : 14;
if (p1_l3[0] <= cutoff) blowout_adj -= 0.5;
if (p2_l3[0] <= cutoff) blowout_adj -= 0.5;
```

e. **Weather/indoor stay as-is** (additive, already correctly signed).

f. **Role adj stays as-is** (already pure additive).

g. **Final sanity clamp** based on the prior's 3σ envelope:
```
const lo = prior.mu - 3 * prior.sd;
const hi = prior.mu + 3 * prior.sd;
if (projection < lo || projection > hi) {
  breakdown.clamped = true;
  projection = clamp(projection, lo, hi);
}
```
Anything that needed clamping is flagged in the breakdown so Phase 5 diagnostics can count it.

**3. New return fields on `ProjectionBreakdown`** (additive, no removals):
```ts
prior_mu: number;
prior_sd: number;
delta_l3: number;
shrunk: number;
blowout_adj: number;
spread_adj_v2: number;
clamped: boolean;
```
Keep `surface_mult`/`sets_mult` in the return for backwards compat — set to 1.0 with a comment that they're deprecated. `projection` now means: post-shrink, post-adjustments, post-clamp.

**4. `project()` needs `tour` to look up the prior.** Add an optional `tour?: 'atp'|'wta'|'unknown'` to `ProjectionInput`. `court-edge-run/index.ts` already derives `tour` for sigma — pass the same value into `project()`. Default `'unknown'` → `wta` row of the prior table (same convention as `pickSigma`).

**5. `court-edge-run/index.ts` minimal touches** (model wiring only — no UI/threshold changes):
- Pass `tour: tourFromKey(ev?.sport_key)` into `projectMatch()` so `project()` can look up the prior.
- Persist new breakdown fields by virtue of `formula: { ...proj }` — no row-shape change.
- One log line per run: `Clamped: X/Y · Blowout flags: Z` (count `proj.clamped` and non-zero `blowout_adj`).

**6. Tests** (5 minimum per `mem://constraints/testing-policy`), in `_shared/court-edge-projection_test.ts`:
1. `project` with two evenly-matched ATP-hard players (L3 = [22,22,22] each) → projection within ±0.5 of `prior.mu = 22.0` (no OVER drift).
2. Same matchup but one player's L3 = [13, 13, 13] → projection drops by ≥ 1.0 game and `blowout_adj < 0`.
3. ML 50/50 (-110/-110) → `spread_adj_v2 = +0.6`; ML 90/10 (-900/+700) → `spread_adj_v2 = -3.0`.
4. Tiny sample (`p1_l3 = [22]`, `p2_l3 = []` → falls back to baseline upstream; we test directly with `p1_l3=[22], p2_l3=[22]`) → shrunk projection stays within 1 game of `prior.mu` (Bayesian shrink dominates).
5. Pathological input (`p1_l3 = [40,40,40]`) → `clamped = true` and projection ≤ `prior.mu + 3*prior.sd`.

### Files Touched
- `supabase/functions/_shared/court-edge-prior.ts` (new)
- `supabase/functions/_shared/court-edge-prior_test.ts` (new — 2 prior-lookup tests)
- `supabase/functions/_shared/court-edge-projection.ts` (rewrite math; add fields; deprecate `surfaceMult`/`setsMult` constants but keep exports)
- `supabase/functions/_shared/court-edge-projection_test.ts` (the 5 tests above)
- `supabase/functions/court-edge-run/index.ts` (pass `tour` into `project`, add one log line)

### Out of scope (later phases)
- Tournament tagging refinements + calibrated tiers + line-range filter (Phase 3)
- Multi-book agreement / weather-required STRONG promotion (Phase 4)
- Diagnostics line + 20% quarantine warning + UI counters (Phase 5)
- Edge-calc thresholds (Phase 1; `EDGE_HARD_CAP_PP` and STRONG/LEAN cutoffs unchanged)
- Data ingestion code (off-limits per your rule)

### Deliverable after switching to default mode
Diff for the 5 files, a one-paragraph summary of what changed and why the OVER bias now goes away, and a re-scored list of the most recent `court_edge_picks` showing which previous STRONG/LEAN picks **downgrade or flip** under the new projection (verdict deltas only — not a full backtest). Then I stop and wait for your sign-off before touching Phase 3.

### Open question before I implement
The blowout cutoff (≤14 Bo3 / ≤22 Bo5) and the shrink strength `k=4` are my best-guess starting values. Want me to:
- **(a)** Ship those defaults and let you tune via a constants block, or
- **(b)** Make them configurable from a `court_edge_config` row so you can A/B without redeploys?

I'd default to (a) for Phase 2 and add the config row in Phase 5 with the rest of the diagnostics. Confirm or override.