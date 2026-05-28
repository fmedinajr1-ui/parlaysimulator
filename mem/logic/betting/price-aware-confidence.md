---
name: Price-aware confidence
description: De-vig, line-guard, and capped-confidence verdict modules gating velocity_spike alerts
type: feature
---

Implemented in `supabase/functions/_shared/price-aware-confidence.ts` and wired
into the `velocity_spike` insert path in `signal-alert-engine/index.ts`.

- **Module A (de-vig)** — `devigPair(over, under)` normalizes implied probs by
  their sum. One-sided fallback strips `ONE_SIDED_VIG_ASSUMED = 0.045`.
- **Module B (line guard)** — `resolvePrice` rejects:
  - `UNPRICED_MAIN` when a side is missing/non-finite
  - `ALT_LINE_SUSPECTED` when odds escape `[-180, +160]` (the +244 strikeout
    artifact that prompted this work)
  - stale prices older than `PRICE_STALE_MS = 5min` (marked `fresh: false`,
    not a hard reject yet)
- **Module C (verdict)** — `evaluate` caps `modelProb` at
  `min(HARD_CONFIDENCE_CAP=0.85, fair_prob + MAX_EDGE_OVER_FAIR=0.08)` and
  emits `STRONG_BACK / BACK / LEAN_BACK / PASS / FADE` based on `edge_pp`
  vs `MIN_EDGE_TO_PLAY=0.03`, `STRONG_EDGE=0.06`, `FADE_EDGE=-0.03`.

Module C is **gated behind `PRICE_AWARE_VERDICT_ENABLED` env var** (defaults
false). When false, A+B still run and write a `metadata.price_aware` block for
observation; broadcast `confidence` and the line-guard reject are no-ops.
When true, broadcast confidence becomes `round(capped_prob*100)` and
line-guard failures hard-skip the velocity_spike emit.

Scored against the **final (post-fade-flip) side** so cap and verdict match
what is actually broadcast.

Tests: `supabase/functions/_shared/price-aware-confidence_test.ts` — 9 passing.

Open follow-ups (revisit before flipping the flag globally):
1. Calibrate `MIN_EDGE_TO_PLAY` against last 200 picks' post-cap edge histogram.
2. Decide if `HARD_CONFIDENCE_CAP=0.85` applies to ALL signals (cascade etc.)
   or only velocity_spike.
3. Promote staleness from soft (`fresh` flag) to hard reject once we trust the
   `updated_at` cadence on `unified_props`.