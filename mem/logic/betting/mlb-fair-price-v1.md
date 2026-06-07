---
name: MLB Fair-Price v1 — admin-only WARN
description: Latency-arb layer in scout-live-edge using mlb-fair-price modules. v1 is log-only, uncalibrated WP, admin Telegram only.
type: constraint
---
MLB Fair-Price layer (Tier-1 HR/K/BB → LIVE_ML edge via winProb) is in measurement mode:
- Every alert MUST go to admin Telegram only (`admin_only: true`, `type: "mlb_fair_price"`).
- Severity is hard-pinned to `WARN`; never `BLOCK`, never auto-bet, never customer broadcast.
- WP coefficients (BETA in `_shared/mlb-fair-price/win-prob.ts`) are unfit. Do not flip `CALIBRATED = true` until refit on Retrosheet PBP with logged data.
- Tier-2 events (1B/2B/3B/IP_OUT) and LIVE_TOTAL are deferred until Tier-1 fill rate proves out from `mlb_fair_price_events`.
- All evaluations (fire OR skip) must be logged to `public.mlb_fair_price_events` for calibration.
**Why:** uncalibrated WP = phantom edge factory; broadcasting to customers would burn trust and bankroll.