---
name: WNBA data collection
description: WNBA wired into team-markets-sync, refresh-todays-props (phase 2), and nuke-sync-rosters. Picks remain hard-muted by signal gates until n≥50 settled per (signal_type, prop_type) in fanduel_prediction_accuracy.
type: feature
---
- team-markets-sync SPORTS includes `basketball_wnba` (H2H/spreads/totals).
- refresh-l10-and-rebuild phase2 invokes `refresh-todays-props` for `basketball_wnba` in parallel (BDL fallback disabled — BDL is NBA-only).
- nuke-sync-rosters DEFAULT_SPORTS includes `wnba` (ESPN roster API).
- No WNBA signal/pick will fire until `fanduel_prediction_accuracy` accumulates n≥50 settled per (signal_type, prop_type) at ≥52.4% 30d hit rate — same gate as take_it_now.
