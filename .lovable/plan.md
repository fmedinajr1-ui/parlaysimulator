

## Update Admin Bankroll to $2000 + Enable Real Mode

### What needs to happen (data updates):

1. **Update `bot_activation_status` for today (2026-03-08)**:
   - Set `real_bankroll = 2000`
   - Set `is_real_mode_ready = true`
   - Set `simulated_bankroll` stays as-is (for historical tracking)

2. **Update `user_bankroll` for the admin user**:
   - Set `bankroll_amount = 2000`
   - Set `peak_bankroll = 2000`

These are simple UPDATE statements against existing rows — no schema changes needed.

