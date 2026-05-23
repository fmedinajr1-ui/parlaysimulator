I’ll redeploy the backend delivery functions and force-send today’s AI Models Intelligence digest once, because today’s earlier log is already marked `sent` and the normal cron will skip it.

Steps:
1. Redeploy `bot-send-telegram` so the Telegram fanout path is definitely live.
2. Redeploy `model-intel-broadcast` so it uses `admin_only: false` and supports `force_send`.
3. Call `model-intel-broadcast` with `force_send: true` for today.
4. Verify the response shows Telegram delivery counts for active recipients.
5. Check the latest AI Models Intelligence log after the force-send.