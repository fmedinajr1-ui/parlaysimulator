

## Problem Analysis

The screenshot shows two bugs in the Telegram strategy parlays formatter:

1. **"Unknown" player names** — The legs stored in `bot_daily_parlays` use `player` as the key, but the formatter reads `leg.player_name`. Every player shows as "Unknown".

2. **"PLAYER_POINTS" raw labels** — The formatter at line 1481 does `(leg.prop_type || 'prop').toUpperCase()` instead of using the `PROP_LABELS` map that exists at line 21. So `player_points` → `PLAYER_POINTS` instead of `PTS`.

Both bugs are in the `formatNewStrategyParlays` function in `bot-send-telegram/index.ts` (lines 1479-1489).

## Fix

**`supabase/functions/bot-send-telegram/index.ts`** — Lines 1479-1489:

- Change `leg.player_name` → `leg.player_name || leg.player` (handles both field naming conventions)
- Change raw `.toUpperCase()` → `PROP_LABELS[leg.prop_type] || leg.prop_type?.toUpperCase()` (use the existing label map)
- Add sport emoji via `getSportEmoji(leg)` (already defined in the file) instead of bare bullet

This is a 2-line fix in the formatter. No database changes needed.

