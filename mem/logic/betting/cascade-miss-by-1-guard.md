---
name: Cascade miss-by-1 guard
description: Danger-band rule and minutes floors that suppress cascade legs whose line sits within ~0.5 std of the player's L10 mean
type: feature
---

The cascade engine (`signal-alert-engine`) suppresses any leg whose line is within a "danger band" of the player's recent mean — those are the legs that statistically miss by 1.

Per leg (NBA player props with std data only):
- `season_mean = last_10_avg_<stat>` (fallback `avg_<stat>`)
- `season_std = <stat>_std_dev`
- `band = max(0.6, 0.5 * std)` for STARTER/ROTATION
- `band = max(0.6, 0.75 * std)` for BENCH or `ROLE_PLAYER` archetype
- DROP when the line is on the wrong side of the mean for the pick AND `|line - mean| < band`

Volume floor:
- STARTER/ROTATION: drop if `avg_minutes < 22`
- BENCH/ROLE_PLAYER: drop if `avg_minutes < 14`

After dropping risky legs the cascade still needs ≥ 3 distinct players or it is suppressed entirely. Dropped legs are persisted on the alert under `metadata.dropped_legs` and shown in the Telegram message under "Filtered (miss-by-1 risk)".

Rendered Telegram cascade entries also show the player's archetype + tier (STARTER / ROTATION / BENCH) + mpg via `formatRoleLine` so we can spot why a bench/role player slipped in.