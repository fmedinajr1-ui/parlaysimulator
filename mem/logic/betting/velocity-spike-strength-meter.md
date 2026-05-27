---
name: Velocity-spike strength meter
description: Slate Outlier (velocity_spike) routing uses combined outcome+CLV hit rate per (sport, prop_type) to auto-decide play vs fade; default is fade.
type: feature
---
Signal-alert-engine loads `fanduel_prediction_accuracy` once per run for `signal_type='velocity_spike'` and routes each candidate via `_shared/velocity-spike-strength.ts`.

- Bayesian smooth: `(correct + 10*0.5) / (n + 10)` over outcome+CLV combined.
- Cohort fallback: sport+prop_type (n≥20) → sport (n≥30) → global.
- combined ≥ 0.55 → PLAY natural side; ≤ 0.42 → FADE; else default FADE (global = 28%).
- Alert metadata.strength = { label, meter 0-100, combined_hit_rate, outcome{n,c}, clv{n,c}, cohort, reason }.
- Telegram card renders `█` meter bar + label + sample size.
