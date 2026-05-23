## Diagnosis

The AI Models Intelligence job is running and writing `status: sent` with a Telegram message id, but it is not reaching the active Telegram audience because:

- `model-intel-broadcast` sends through `bot-send-telegram` with `admin_only: true`.
- `bot-send-telegram` only sends to the single configured admin chat id, not the `bot_authorized_users` recipients.
- There are 8 active Telegram users in `bot_authorized_users`, all with chat ids.
- Their `tier` values are currently blank, so the existing `getRecipientsForTier(..., 'all_access')` helper would exclude them unless we handle legacy blank tiers.

## Plan

1. Update the shared Telegram recipient resolver so active users with a blank tier are treated as legacy `all_access` recipients for paid alert fanout.
2. Update `bot-send-telegram` so when `admin_only: false`, it broadcasts the message to every active eligible Telegram recipient instead of skipping with “Only admin chat delivery is configured”.
3. Update `model-intel-broadcast` to call `bot-send-telegram` with `admin_only: false`, so AI Models Intelligence reaches the same active Telegram users as the bot audience.
4. Preserve admin-only behavior for test/admin alerts so existing admin notifications do not accidentally fan out.
5. Deploy the changed edge functions and run a dry/forced verification call to confirm the response reports recipient delivery counts instead of only a single admin message id.