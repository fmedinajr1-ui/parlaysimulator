
Phase 3 per the plan I already laid out: migrate top 4 highest-volume generators to write to `bot_daily_picks` (the canonical pick table) and emit through the v2 voice/pick-formatter, instead of formatting their own Telegram messages.

Let me check what those 4 generators currently look like to scope the migration accurately.
