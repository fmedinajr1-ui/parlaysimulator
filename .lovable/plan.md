

## Activate Real Mode — $2,000 Bankroll

### What This Does
Flips `is_real_mode_ready = true` on today's `bot_activation_status` row and sets `real_bankroll = 2000`. This means:
- All engines will use your **$2,000 real bankroll** for stake sizing instead of the ~$68K simulated one
- Telegram `/bankroll` commands will read/write `real_bankroll`
- Settlement will track P&L against your real bankroll going forward
- The Bot Activation Card in the UI will show "Real mode ready"

### Steps

1. **Update `bot_activation_status`** for today (2026-03-09):
   - Set `is_real_mode_ready = true`
   - Set `real_bankroll = 2000`
   - Set `activated_at = now()`

2. **Update `user_bankroll`** to confirm admin bankroll is $2,000 (already set, but verify `peak_bankroll` is correct)

3. **Verify** by querying the updated row to confirm real mode is active

### Impact on Stakes
With a $2,000 real bankroll, your tier stakes become:
- **Execution (5%)**: $100
- **Validation (2.5%)**: $50
- **Exploration (1%)**: $20
- **Lottery (0.5%)**: $10

These are significantly smaller than the simulated stakes (~$3,400 execution), which is correct for a $2,000 bankroll.

