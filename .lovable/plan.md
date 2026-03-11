

## Review: Today's Slate, Bankroll Sync, and Telegram Cleanup

### Today's Slate (March 11)

10 active parlays, all `pending_approval`:

| Strategy | Count | Stake Each |
|----------|-------|------------|
| `elite_categories_v1_execution_grind_stack` | 3 | $100 |
| `elite_categories_v1_execution_shootout_stack` | 1 | $100 |
| `elite_categories_v1_exploration_optimal_combo` | 4 | $50 |
| `role_stacked_5leg` | 1 | $50 |
| `role_stacked_8leg` | 1 | $25 |

Key players appearing: Dean Wade (REB), Christian Braun (REB), Jaylon Tyson (3PT), Trey Murphy III (3PT), Russell Westbrook (3PT), Tristan da Silva (3PT/REB), Keyonte George (3PT), OG Anunoby (3PT), Saddiq Bey (PTS), Ace Bailey (3PT).

**Accuracy alignment with yesterday's winners**: Yesterday's wins came from `grind_stack` (2W/1L), `shootout_stack` (2W), `role_stacked_5leg` (2W), and `role_stacked_8leg` (1W). Today's slate uses the same strategy mix. The `THREE_POINT_SHOOTER` category remains heavily featured — the new streak penalty will reduce its weight from ~1.30 to ~0.86 on the next calibration run, but today's parlays were generated before that change deployed.

---

### Bankroll Issue

**Root cause**: The admin's `bot_authorized_users.bankroll` is stuck at **$9,041** while the real tracked bankroll in `bot_activation_status.simulated_bankroll` is **$67,861**. Here's why:

- Settlement (line ~1468) updates every customer's bankroll by scaling the bot's daily P&L proportionally: `customerPnl = authPL * (customerStake / botBaseStake)`
- But the admin's `bankroll` in `bot_authorized_users` gets the same scaled treatment as any customer — it's not synced to the authoritative `bot_activation_status.simulated_bankroll`
- The `bankroll_confirmed_date` is `nil` for ALL users, meaning nobody has confirmed their bankroll today (the check-in ran but confirmation hasn't happened)

**Fix**: After settlement updates `bot_activation_status.simulated_bankroll`, sync that value back to the admin's `bot_authorized_users.bankroll` so the daily check-in, stake calculations, and Telegram messages reflect the real bankroll.

---

### Telegram Message Cleanup

**The "Bot Update" spam** comes from line 188 in `bot-send-telegram`:
```
default: return `📌 Bot Update: ${JSON.stringify(data)}`
```

This fires whenever a function sends a notification type that doesn't have a formatter. The main offender is `bot-adaptive-intelligence` sending `type: 'custom'` (line 514), which dumps raw JSON to the admin.

**Plan — 3 changes to `bot-send-telegram/index.ts`:**

1. **Silence the `custom` type**: Add a case for `'custom'` that extracts the `data.message` field cleanly instead of dumping JSON
2. **Add admin-only suppression list**: Skip sending certain internal notification types to admin entirely (or consolidate them into a single daily digest). Types to suppress or consolidate:
   - `weight_change` — category weight updates (happens automatically, no action needed)
   - `quality_regen_report` — internal regen loop stats
   - `hit_rate_evaluation` — execution hit rate check
   - `doctor_report` — pipeline health (only alert on failures)
3. **Default case cleanup**: Replace the raw JSON dump with a short summary or suppress entirely

**Plan — 1 change to `bot-settle-and-learn/index.ts`:**

4. **Sync admin bankroll**: After the `bot_activation_status` upsert, update the admin's `bot_authorized_users.bankroll` to match `finalBankroll` (the authoritative simulated bankroll)

### Files to Edit

- `supabase/functions/bot-send-telegram/index.ts` — add `custom` handler, suppress noisy types, clean default case
- `supabase/functions/bot-settle-and-learn/index.ts` — sync admin bankroll after settlement

