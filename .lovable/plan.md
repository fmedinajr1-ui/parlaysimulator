

# Composite Average Filter + Admin Telegram Alert for Conflicting Legs

## Overview
After parlays are generated and deduped, run each leg through a weighted composite average (L10/L5/L3/H2H) check. Instead of auto-removing conflicting legs, send them to admin via Telegram as a separate "Composite Conflict Report" message with full breakdowns so you can decide whether to keep, flip, or remove each leg.

## Composite Calculation

```
Composite = (L10 × 0.20) + (L5 × 0.25) + (L3 × 0.30) + (H2H × 0.25)
If H2H < 2 games: L10 × 0.25, L5 × 0.30, L3 × 0.45
```

A leg **conflicts** when:
- OVER pick but composite < line
- UNDER pick but composite > line

## Data Source
All from `nba_player_game_logs` (already queried earlier in the function):
- **L10**: last 10 games avg for the stat
- **L5**: last 5 games avg
- **L3**: last 3 games avg
- **H2H**: games vs today's opponent (using the `opponent` column)

Opponent resolved from `teamGameContextMap.opponentAbbrev` already built in the function.

## Telegram Message Format
New notification type `composite_conflict_report` sent to admin only:

```
⚠️ COMPOSITE CONFLICT REPORT — Mar 16

📋 12 legs flagged across 8 parlays

1️⃣ LeBron James PTS OVER 25.5
   L10: 26.2 | L5: 23.8 | L3: 21.0 | H2H: 22.5 (3g)
   Composite: 23.1 < line 25.5 ❌
   Parlay: #4821 (Execution)

2️⃣ Jayson Tatum REB UNDER 7.5
   L10: 7.8 | L5: 8.2 | L3: 9.1 | H2H: 8.0 (2g)
   Composite: 8.3 > line 7.5 ❌
   Parlay: #4835 (Validation)
```

## Implementation

### 1. Edit `bot-generate-daily-parlays/index.ts`
Insert after the dedup step (~line 10981) and before DB insert (~line 10991):

- Batch-fetch last 10 game logs for all unique NBA players across all deduped parlays (single query, ordered by `game_date desc`)
- For each leg, compute L10/L5/L3 averages from the logs
- For H2H, filter logs where `opponent` matches today's opponent (from `teamGameContextMap`)
- Calculate weighted composite, compare to line + side
- Collect all conflicting legs into an array
- After DB insert, send a single `composite_conflict_report` Telegram message with all conflicts

Legs are **not auto-removed** — they stay in the parlay. This is an advisory alert for admin review.

### 2. Edit `bot-send-telegram/index.ts`
- Add `composite_conflict_report` to `NotificationType`
- Add formatter that renders the conflict list with L10/L5/L3/H2H breakdowns per leg

### Files to Edit
- `supabase/functions/bot-generate-daily-parlays/index.ts` — add composite check + Telegram call
- `supabase/functions/bot-send-telegram/index.ts` — add notification type + formatter

