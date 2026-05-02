# Project Memory

## Core
parlay-engine-v2 MIN_LEG_CONFIDENCE pinned at 0.60. Never raise without explicit user approval.
Cascade legs must clear a `0.5*std` band around L10 mean (BENCH/ROLE_PLAYER need `0.75*std`) and pass minutes floors (22 / 14 mpg) — see cascade-miss-by-1-guard.

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
