# Project Memory

## Core
parlay-engine-v2 MIN_LEG_CONFIDENCE pinned at 0.60. Never raise without explicit user approval.
Cascade legs must clear a `0.5*std` band around L10 mean (BENCH/ROLE_PLAYER need `0.75*std`) and pass minutes floors (22 / 14 mpg) — see cascade-miss-by-1-guard.
Team/game legs in parlay-engine-v2 require a real model score; never default to constant confidence. Drop spreads with |line| ≥ 9.5. Max 1 team-market leg per game per parlay. Lottery requires ≥1 player leg.
Scout Speed Edge is Phase-0 heuristic until lag_edges has ≥2 weeks of actual_move data — do not tune scoreEdge by hand.

## Memories
- [Raw props confidence fix](mem://infrastructure/pipeline/raw-props-confidence-fix) — Why parlays go empty when risk/sweet are thin + the orchestrator .catch crash
- [Parlay leg-confidence floor](mem://logic/parlay/leg-confidence-floor) — MIN_LEG_CONFIDENCE=0.60 rule, presets, and Telegram broadcaster health notes
- [Parlay broadcast mapping](mem://logic/parlay/broadcast-mapping) — bot_parlay_broadcasts must store parlay_id + parlay_date; audit via v_parlay_broadcast_audit
- [Alert explainer contract](mem://logic/alerts/explainer-contract) — Per-player engine_reasoning v1 + group_reasoning + verdict mix on fanduel_prediction_alerts metadata
- [Cascade miss-by-1 guard](mem://logic/betting/cascade-miss-by-1-guard) — Danger-band + minutes floor suppressing cascade legs that statistically miss by 1
- [Tennis data sync](mem://logic/betting/tennis-data-sync) — Court.Edge layered inputs (Odds API → PrizePicks → TA jsfrag → surface baseline); one-side-missing capped to LEAN_*
- [Cascade sim panel](mem://logic/alerts/cascade-sim-panel) — $100 TAIL/FADE bankroll sim appended to cascade Telegram alerts (display aid only)
- [Pitcher K Over (Ace Edge)](mem://logic/betting/pitcher-k-over-model) — Standalone pitcher strikeouts OVER engine; Bayesian K9 + opp K-rate + IP cap; replaces retired team No-HR model
- [No HR Team — RETIRED](mem://logic/betting/no-hr-team-model) — RETIRED 2026-05-02 after 0/3; analyzer disabled, replaced by pitcher-k-over-model
- [RBI Unders bake-off](mem://logic/betting/mlb-rbi-system) — Rebuilt RBI Unders analyzer with 4 parallel L3-gate variants (A/B/C/D); only variant C broadcasts during bake-off; settled via mlb-over-tracker; accuracy view `mlb_rbi_under_variant_accuracy`
- [Spike personal share link](mem://features/spike/personal-link) — profiles.spike_share_token + /spike/:token route + share_my_link agent tool + SpikeShareCard UI
- [Hard Rock line gating](mem://logic/betting/hardrock-line-gating) — signal-alert-engine drops cascade/single legs not tradable on hardrockbet via The Odds API; metadata.hrb_verified drives Telegram footer
- [Nuke Parlay Scout (NBA)](mem://logic/parlay/nuke-scout) — Blowout-script engine: scoring weights, hard floors, role-player OVER template, +1000/+3000 odds band, daily 21:00/16:00 UTC crons
- [Team leg intelligence](mem://logic/parlay/team-leg-intelligence) — Real scoring for team/MLB-raw legs, fat-spread drop, 1 team-market per game, lottery requires ≥1 player
- [Ladder Challenge multi-sport](mem://logic/betting/ladder-challenge-multisport) — Daily Lock/Strong/Lean across NBA+MLB with odds floor and always-on Telegram
- [Cross-sport bulk parlay generator](mem://logic/parlay/cross-sport-generator) — Perplexity-fed multi-sport sweet spots + 25-ticket bulk assembler (8 Lock / 8 Strong / 6 Stretch / 3 Lottery), player-primary, team legs ≤40%
- [Profitability math (BANKROLL_MATH_V1)](mem://logic/betting/profitability-math) — Bayesian-smoothed p̂, ¼-Kelly stake, 7d EV gates, daily envelope
- [Leg validation gate](mem://logic/parlay/leg-validation-gate) — Shared hard/soft verifier (canonical team, venue alignment, no-same-game, weak-fav haircut) wired into cross-sport-parlay-generator
- [Scout Speed Edge](mem://features/scout/speed-edge) — Phase-0 lag hunter (live_events + market_snapshot + lag_edges), EV_FLOOR 0.03, 15s window, ½-Kelly, admin Telegram + /admin/scout-speed UI
- [Prop alert verifier](mem://logic/betting/prop-alert-verifier) — Deep-research second-opinion agent: Perplexity sonar-deep-research + GPT-5 judge, soft-tags every alert with APPROVE/CAUTION/REJECT + multiplier, realtime trigger + 5-min sweep, 300/day cap with Gemini fallback
- [Velocity-spike strength meter](mem://logic/betting/velocity-spike-strength-meter) — Slate Outlier auto-routes play vs fade via combined outcome+CLV hit rate per cohort
- [Price-aware confidence](mem://logic/betting/price-aware-confidence) — De-vig + line-guard always run on velocity_spike; BACK/LEAN/FADE verdict gated by PRICE_AWARE_VERDICT_ENABLED env flag
- [take_it_now prop gate](mem://logic/betting/take-it-now-prop-gate) — TAKE_IT_NOW_PROP_BLOCK allowlist + 30d break-even + n>=50 + 7d 40% brake, telemetry in stats.take_it_now_gate
