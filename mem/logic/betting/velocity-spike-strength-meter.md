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

## Card copy rules (post-Acuña fix)
- Header + badge + bet line must name the **same side** — never render the word "FADE" next to the bet. Fade-mode header reads "FADE PUBLIC {originalSide}"; badge reads "Action: BACK {side}"; a separate "Public lean: {originalSide}" line marks the contrarian framing.
- Card always opens with explicit `*Bet:* {player} {side} {line} ({prop})` TL;DR.
- For fixed-payout books (`prizepicks|underdog|sleeper|dabble|pick6`) suppress American odds and gap; show `💎 PrizePicks pick (fixed payout)` instead.
- Pre-broadcast **health + cold-form gate** (`_shared/velocity-spike-health-gate.ts`): hard-blocks alerts when player is OUT/DOUBTFUL/IL, when MLB L5 BA < .200 on contact-prop Overs, when L5 hits/TB per game < 60% of the prop line, or when a high-impact injury (hamstring/thumb/wrist/oblique/etc.) collides with a contact-prop Over. GTD/QUESTIONABLE or K-rate ≥30% surface as `⚠️ Form check` soft-warns instead.
- Pre-broadcast **engine-reasoning gate**: velocity_spike alerts are only broadcast when `metadata.engine_reasoning.verdict` is `STRONG` (high-conviction back) or `WEAK` (high-conviction fade). `LEAN`, `NEUTRAL`, and missing verdicts are hard-skipped — prevents low-conviction "BACK X" recs with `🟡 NEUTRAL · juice +X · volatile minutes` underneath, and ambiguous LEAN cards.
- **Auto-broadcast trigger**: DB trigger `trg_velocity_spike_autobroadcast` on `fanduel_prediction_alerts` fires `net.http_post` to `signal-alert-telegram` the moment a velocity_spike row lands with `metadata.engine_reasoning.verdict` ∈ {`STRONG`,`WEAK`}. The 5-min cron remains as a safety net; the trigger removes the wait so today's slate alerts go out as soon as the engine writes them.
