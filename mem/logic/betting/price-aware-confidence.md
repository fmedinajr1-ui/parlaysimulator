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

Module C (BACK/FADE verdict) is **disabled for `take_it_now` and
`velocity_spike`** as of the 2026-05-28 audit. The 14-day audit found 100% of
those alerts overshoot a probability cap by ~50pp because broadcast
`confidence` is a juice-gap heuristic (60–90), NOT a calibrated probability,
and the picked side is the positive-juice dog (avg de-vigged fair side 27–33%).
Running cap math on a heuristic is a category error.

What runs today:
- Module A (de-vig) — always, recorded under `metadata.price_aware.fair_prob`.
- Module B (line guard) — always computed; hard-skips emit only when
  `PRICE_AWARE_VERDICT_ENABLED=true` (defaults false).
- Module C — kept in code for future signals whose `modelProb` is a real
  probability (e.g. pitcher-k-over-model, rbi unders). Wire those in by
  importing `evaluate` from `_shared/price-aware-confidence.ts`.

Observation block written to `fanduel_prediction_alerts.metadata.price_aware`:
`{ side_scored, fair_prob, implied_prob, vig, raw_heuristic_conf, mode: 'line_health_only' }`.

Scored against the **final (post-fade-flip) side** so cap and verdict match
what is actually broadcast.

Tests: `supabase/functions/_shared/price-aware-confidence_test.ts` — 9 passing.

Open follow-ups (revisit before flipping the flag globally):
1. Replace `derived_confidence` with a calibrated probability per signal type
   (e.g. logistic from juice-gap + cohort hit rate) so Module C can apply.
2. ✅ FIXED 2026-05-28 — join now works via `public.v_alert_accuracy`
   (composite key on `event_id + player_name + prop_type + signal_type`,
   indexes on both sides). Legacy 4,389 bare-event_id accuracy rows are
   excluded (verified zero matching alerts in any ±6h window). 30-day audit
   via the view: 16,145 alerts, 12% settled, 575H / 1362M = ~30% hit rate
   on the picked side — confirms the heuristic is currently fading itself.
3. Promote staleness from soft (`fresh` flag) to hard reject once we trust the
   `updated_at` cadence on `unified_props`.