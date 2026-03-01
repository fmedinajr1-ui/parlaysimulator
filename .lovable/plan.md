

## Extra Plays (Admin Telegram) + Engine-Wide Outcome Tracking — ✅ IMPLEMENTED

### What was done:

1. **Database**: Added `outcome`, `actual_value`, `settled_at` columns to `mispriced_lines`
2. **`verify-all-engine-outcomes`**: Added mispriced lines verification section after Heat parlays
3. **`generate-extra-plays-report`**: New edge function that queries sweet spots + mispriced lines, excludes parlay picks, sends to admin via Telegram
4. **`bot-send-telegram`**: Added `extra_plays_report` and `engine_accuracy_report` types with formatters
5. **`telegram-webhook`**: Added `/extras` and `/engineaccuracy` admin commands with handler functions
