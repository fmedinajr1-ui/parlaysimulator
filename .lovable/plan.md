# Wire Remotion Worker: Auto-Cron + Telegram Admin Trigger

The Remotion worker is live at `https://remotion-worker.onrender.com` and `REMOTION_WORKER_URL` is saved as a secret. The existing `tiktok-render-orchestrator` edge function already reads that secret and POSTs render jobs to the worker. We just need to drive it from two places: a recurring cron job and a Telegram admin command/button.

## What gets built

### 1. Auto-cron (every 5 minutes)
- New edge function: `tiktok-render-cron`
  - Calls `tiktok-render-orchestrator` with empty body (it already auto-picks the next `approved` script from the queue).
  - Bails if no approved scripts exist (orchestrator already returns "No approved scripts in queue").
  - Logs each run into `pipeline_runs` for observability (matches existing pattern from `tiktok-blotato-cron`).
- Schedule via `pg_cron` (every 5 min) using the `supabase--insert` tool — not a migration — since the URL/anon key are project-specific.

### 2. Telegram admin trigger
- New edge function: `telegram-admin-render`
  - Listens for the `/render` command (and an inline button callback) sent by the admin chat ID `Destiny_0711` (already whitelisted per memory).
  - Two modes:
    - `/render` → triggers orchestrator on next approved script in queue.
    - `/render <script_id>` → triggers a specific script.
  - Replies to Telegram with status: which script picked up, render ID, and worker job ID.
- Hook into existing Telegram polling (`telegram-poll` style) — reuse the project's existing telegram bot infrastructure (`bot-send-telegram` is already deployed).
- Add an inline keyboard button "🎬 Render next script" sent on a daily digest so the admin can tap-to-render from Telegram without typing.

### 3. Admin-page button (bonus, already partially exists)
- `src/pages/admin/AdminTikTok.tsx` already has a per-script "Render" button calling `tiktok-render-orchestrator`.
- Add one new "▶ Render next approved" button at the top that calls orchestrator with `{}` (queue mode), so the admin can manually drain the queue from the web UI too.

## Technical details

- Cron SQL (executed via supabase--insert):
  ```sql
  select cron.schedule(
    'tiktok-render-orchestrator-every-5min',
    '*/5 * * * *',
    $$ select net.http_post(
      url:='https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/tiktok-render-cron',
      headers:='{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb,
      body:='{}'::jsonb
    ); $$
  );
  ```
- Concurrency safety: orchestrator already updates `tiktok_video_renders.step` and the daily cap (2 posts per persona) prevents runaway loops.
- Telegram command parsing follows existing patterns; admin chat ID gate uses `bot_owner_rules` whitelist.
- No DB schema changes needed — `tiktok_video_renders` and `tiktok_video_scripts` already exist.

## Out of scope
- Building a new full Telegram polling loop if one isn't already live (will reuse existing `bot-send-telegram` infra). If polling is missing, I'll flag it before adding cron+webhook plumbing.
- No changes to the Remotion worker itself — it's already deployed and healthy.
