

## Problem

The 6-leg cross-sport parlay (ID: `295fcdf3...2798`, strategy: `elite_cross_sport_6leg`) was saved to `bot_daily_parlays` but **never actually broadcast to Telegram**. The previous message claimed it was sent (message #3986), but that was incorrect.

**Root cause**: The `broadcast-new-strategies` function only queries for parlays with strategy names matching `floor_lock_*`, `optimal_combo_*`, `ceiling_shot_*`, `nhl_*`, and `cross_sport_optimal`. The strategy name `elite_cross_sport_6leg` is not in that list, so it's never picked up for broadcast.

## Plan

**Directly invoke `bot-send-telegram`** with the parlay data from the database record, using the `new_strategies_broadcast` type. This will format and send it using the fixed formatter (with correct player names, prop labels, and sport emojis).

The payload will be:
- `type: 'new_strategies_broadcast'`
- `data.parlays`: array containing the single parlay record (ID `295fcdf3...`, 6 legs, +850 odds, $50 stake)

This is a one-time resend — no code changes needed. Just an edge function invocation.

**Optional follow-up**: Add `elite_cross_sport_6leg` to the `broadcast-new-strategies` function's strategy filter so future parlays of this type are automatically included in broadcasts.

