---
name: FanDuel line gating for cascade alerts
description: signal-alert-engine validates every NBA leg against live FanDuel lines via The Odds API; cascades require >=3 FD-tradable legs or are dropped, and metadata.fd_verified drives the "Lines verified on FanDuel & DraftKings" footer in Telegram
type: feature
---

`supabase/functions/_shared/fanduel-lines.ts` pulls live `fanduel` player-prop lines (points, rebounds, assists, threes, PRA, steals, blocks) from The Odds API once per engine run, cached 5 min in-memory.

`signal-alert-engine` calls `checkFdLine()` for every NBA cascade leg, take_it_now leg, and velocity_spike leg. A leg is dropped if:
- FD has no listing for `(event_id, player, prop_type)`
- FD line differs from the alert line by > `FD_LINE_TOLERANCE` (0.5)
- FD price for the alerted side is worse than `FD_MAX_JUICE` (-200) — unbettable juice

If fewer than `CASCADE_MIN_PLAYERS` (3) legs survive FD filtering the cascade is suppressed and `stats.dropped_no_fd` increments. When FD coverage is empty for the run (API down, sport off-hours), all NBA alerts are suppressed.

On surviving alerts the inserted `fanduel_prediction_alerts` row uses FD's actual `line`, `over_price`, `under_price`, sets `bookmaker = 'fanduel'`, and stores `metadata.fd_verified = true` plus per-leg `fd_line` / `fd_price`. `signal-alert-telegram` reads `metadata.fd_verified` and appends a `📘 Lines verified on FanDuel & DraftKings` footer (DK lines are already cross-referenced upstream in `_shared` odds pulls).

Tests: `supabase/functions/_shared/fanduel-lines_test.ts` (5 cases per testing-policy memory).

Replaces the deprecated Hard Rock gate (HR sportsbook was dropped 2026-06-08).