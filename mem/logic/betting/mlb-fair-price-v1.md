---
name: MLB Fair-Price v1 — SHUT DOWN
description: MLB Fair-Price layer is fully disabled. Do not re-enable without refit WP + product sign-off.
type: constraint
---
MLB Fair-Price v1 is SHUT DOWN:
- `scout-live-edge` no longer calls `evaluateMlbFairPrice` (block commented out).
- `mlb-live-events-ingest` no longer attaches `fair_price` metadata to posted events.
- `mlb-fair-price-digest`, `mlb-fair-price-outcome-attacher`, and `mlb-fair-price-closing-resolver` return a `disabled: true` no-op so cron entries don't error.
- Do NOT re-enable. WP in `_shared/mlb-fair-price/win-prob.ts` is uncalibrated; any re-enable requires refit on real PBP + explicit product sign-off + memory update.
**Why:** uncalibrated WP = phantom edge factory; leaving it running burned admin noise with no shippable signal.