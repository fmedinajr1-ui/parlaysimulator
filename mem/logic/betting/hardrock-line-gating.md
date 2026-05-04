---
name: Hard Rock Bet line gating for cascade alerts
description: signal-alert-engine validates every NBA leg against live HRB lines via The Odds API; cascades require ≥3 HRB-tradable legs or are dropped, and metadata.hrb_verified drives the "Lines verified on Hard Rock Bet" footer in Telegram
type: feature
---

`supabase/functions/_shared/hardrock-lines.ts` pulls live `hardrockbet` player-prop lines (points, rebounds, assists, threes, PRA, steals, blocks) from The Odds API once per engine run, cached 5 min in-memory.

`signal-alert-engine` calls `checkHrbLine()` for every NBA cascade leg, take_it_now leg, and velocity_spike leg. A leg is dropped if:
- HRB has no listing for `(event_id, player, prop_type)`
- HRB line differs from the alert line by > `HRB_LINE_TOLERANCE` (0.5)
- HRB price for the alerted side is worse than `HRB_MAX_JUICE` (-200) — unbettable juice

If fewer than `CASCADE_MIN_PLAYERS` (3) legs survive HRB filtering the cascade is suppressed and `stats.dropped_no_hrb` increments. When HRB coverage is empty for the run (API down, sport off-hours), all NBA alerts are suppressed — better silent than untradable.

On surviving alerts the inserted `fanduel_prediction_alerts` row uses HRB's actual `line`, `over_price`, `under_price`, sets `bookmaker = 'hardrockbet'`, and stores `metadata.hrb_verified = true` plus per-leg `hrb_line` / `hrb_price` in `player_breakdown`. `signal-alert-telegram` reads `metadata.hrb_verified` and appends a `📘 Lines verified on Hard Rock Bet` footer.

Tests: `supabase/functions/_shared/hardrock-lines_test.ts` (5 cases per testing-policy memory).