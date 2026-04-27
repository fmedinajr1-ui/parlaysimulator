# Project Memory

## Core
parlay-engine-v2 MIN_LEG_CONFIDENCE pinned at 0.60. Never raise without explicit user approval.

## Memories
- [Raw props confidence fix](mem://infrastructure/pipeline/raw-props-confidence-fix) — Why parlays go empty when risk/sweet are thin + the orchestrator .catch crash
- [Parlay leg-confidence floor](mem://logic/parlay/leg-confidence-floor) — MIN_LEG_CONFIDENCE=0.60 rule, presets, and Telegram broadcaster health notes
- [Parlay broadcast mapping](mem://logic/parlay/broadcast-mapping) — bot_parlay_broadcasts must store parlay_id + parlay_date; audit via v_parlay_broadcast_audit
- [Alert explainer contract](mem://logic/alerts/explainer-contract) — Per-player engine_reasoning v1 + group_reasoning + verdict mix on fanduel_prediction_alerts metadata
