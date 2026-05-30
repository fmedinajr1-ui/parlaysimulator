---
name: take_it_now prop gate
description: TAKE_IT_NOW_PROP_BLOCK — allowlist + 30d break-even + n>=50 + 7d 40% brake gating take_it_now alerts
type: feature
---
signal-alert-engine applies a hard gate before emitting any `take_it_now` alert. Overrides model_edge.

Allowlist (probationary): `pitcher_strikeouts`, `pitcher_hits_allowed`. Everything else → `not_in_allowlist`.

Per-run, loads `fanduel_prediction_accuracy` (signal_type='take_it_now', verified_at last 30d) into 30d + 7d maps per prop_type. For each candidate:
- `not_in_allowlist` → mute
- 30d n < 50 → `probation_low_sample` mute
- 30d rate < 0.524 (break-even at -110) → `below_breakeven_30d` mute
- 7d n ≥ 5 and 7d rate < 0.40 → `rolling_7d_brake` mute

Telemetry returned as `stats.take_it_now_gate` = { allowlist, low_sample, below_breakeven, brake_7d, passed }. Per-mute console line logs prop_type, reason, 30d and 7d hits/total/rate.

Tuning: edit `TAKE_IT_NOW_ELIGIBLE_PROPS`, `TAKE_IT_NOW_MIN_HIT_RATE_30D`, `TAKE_IT_NOW_MIN_SAMPLE_30D`, `TAKE_IT_NOW_MIN_HIT_RATE_7D` at the top of `supabase/functions/signal-alert-engine/index.ts`.
