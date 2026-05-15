## Goal
Get the TikTok auto-posting pipeline producing daily content for `the_analyst` by scheduling `tiktok-script-generator` directly via pg_cron — no new edge function needed.

## Change
Add one pg_cron job that POSTs to the existing `tiktok-script-generator` edge function twice daily.

- **Schedule:** `0 12,20 * * *` (UTC) → 8am & 4pm ET
- **Job name:** `tiktok-daily-generator-the-analyst`
- **Body:** `{"persona_key":"the_analyst","auto_approve":true}`
- **Auth:** anon key in `apikey` header (function deploys with `verify_jwt = false`)

## Downstream flow (already wired, no changes)
1. `tiktok-script-generator` builds script → if `compliance_score ≥ 75` inserts as `approved`
2. `tiktok-render-cron` (every 10 min) picks up approved scripts → `tiktok-render-orchestrator` enforces `DAILY_CAP=2`/persona/ET-day → dispatches to Remotion worker
3. Worker callback → `tiktok-render-callback` marks render complete → enqueues to `tiktok_post_queue`
4. `tiktok-blotato-cron` (every minute) drains queue → posts via `tiktok-blotato-post`

## Memory update
Update `mem://features/tiktok/blotato-autopost.md` to reflect the simplified setup (direct pg_cron invocation, no wrapper function).

## Verification
- Confirm job appears in `cron.job`
- Manually trigger `tiktok-script-generator` once with the same body to validate end-to-end before waiting for first scheduled run
- Watch `tiktok_video_scripts` for an `approved` row, then `tiktok_video_renders`, then `tiktok_post_queue`

## Out of scope
- Other personas (stay disabled until pilot proves the loop)
- Any changes to render/posting cron jobs (already healthy)
