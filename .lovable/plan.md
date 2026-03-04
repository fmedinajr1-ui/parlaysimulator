

## Fix: Force Deployment of Three Pipeline Gates

### Root Cause
All three code fixes (L10 gate in cluster builder, quality regen dedup, force-fresh L10 gate) are **already correct in the source files** but are not running in production. The deployed edge functions are still running old code. Evidence:

- Shootout parlays have `hit_rate: 0.74` (74%) and `0.67` (67%) — should be blocked by 80% gate at line 9078
- 3 identical shootout, role_stacked_5leg, and role_stacked_8leg parlays exist — dedup at lines 214-258 never ran
- Zero `quality_regen_dedup_identical` or `quality_regen_kept_attempt_*` in `lesson_learned` — confirms old code
- Force-fresh has correct L10 gate at lines 287-293, but 9 `force_mispriced_conviction` parlays have nil hit rates

### What Needs to Happen

Each function needs a trivial change to force redeployment. The actual logic is already correct:

**1. `bot-generate-daily-parlays/index.ts`** — Add a version comment at top to trigger redeploy. The L10 gate at line 9075-9081 is correct (`l10_hit_rate` check with decimal-to-percent conversion, 80% threshold).

**2. `bot-quality-regen-loop/index.ts`** — Bump version marker (v3 → v4) to force redeploy. The unconditional dedup at lines 214-258 is correct (fingerprints all pending parlays by `player_name|prop_type|side`, voids duplicates keeping earliest).

**3. `bot-force-fresh-parlays/index.ts`** — Add version comment to force redeploy. The sweet spot lookup at lines 103-125 and 80% L10 gate at lines 287-293 are correct. The issue is the deployed version predates these additions.

### Changes Per File

| File | Change |
|------|--------|
| `bot-generate-daily-parlays/index.ts` | Add `// v2.1 — forced redeploy for cluster L10 gate 2026-03-04` at line 1 |
| `bot-quality-regen-loop/index.ts` | Change `v3` → `v4` in header comment, add timestamp to force deploy |
| `bot-force-fresh-parlays/index.ts` | Add `// v2 — forced redeploy for L10 gate 2026-03-04` at line 1 |

All three are single-line version bumps to trigger the deploy pipeline. No logic changes needed — the logic is already correct.

