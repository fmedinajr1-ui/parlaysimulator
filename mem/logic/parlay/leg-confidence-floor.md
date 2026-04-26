---
name: parlay-engine-v2 leg-confidence floor
description: MIN_LEG_CONFIDENCE pinned at 0.60 — do not raise without explicit user approval
type: constraint
---
`supabase/functions/_shared/parlay-engine-v2/config.ts` constants:
- `MIN_LEG_CONFIDENCE = 0.60`
- `PREFERRED_LEG_CONFIDENCE = 0.68`
- `S_TIER_CONFIDENCE_OVERRIDE = 0.60`
- Presets `v2.2` and `v2.3-balanced` also pinned at `0.60`. `v2.3-max-ROI` stays at `0.75` (intentionally strict variant).

**Why:** When raised to 0.65 the engine produced only ~4 parlays/day because 58 of 59 candidates failed the floor, even though the broadcaster + Telegram pipe were fully healthy. User explicitly restored to 60% on 2026-04-26.

**Rule:** Do not raise this floor without the user asking. If quality degrades, propose a midpoint (0.62) for discussion — never silently re-tighten.

**Telegram broadcast pipe:** `parlay-engine-v2-broadcast` runs against `bot_daily_parlays`, gated by `bot_owner_rules.parlay_iq_autobroadcast_enabled` (currently enabled). Per-parlay dedup via `bot_parlay_broadcasts.parlay_id`. Pipe is healthy; if "no Telegram messages" is reported, the bottleneck is almost always engine yield, not delivery.
