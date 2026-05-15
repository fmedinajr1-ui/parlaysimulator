---
name: TikTok Blotato auto-posting
description: Per-account auto-post via Blotato (queue + cron + Publish tab buttons), plus fully autonomous daily generation pipeline for pilot persona "the_analyst".
type: feature
---
# TikTok Pipeline — Daily Autonomous Generation

## Cron schedule (UTC)
- `tiktok-daily-generator-the-analyst` (pg_cron jobid 157) — `0 12,20 * * *` (8am & 4pm ET).
  Direct net.http_post to `tiktok-script-generator` with body `{"persona_key":"the_analyst","auto_approve":true}`.
  No wrapper edge function — pg_cron calls the generator directly.
- `tiktok-render-cron` — `*/10 * * * *` → renders next approved script.
- `tiktok-blotato-cron` — every minute, posts queued videos.
- `tiktok-metrics-sync-6h` and `tiktok-ab-resolver-daily` already existed.

## Auto-approve gate
`tiktok-script-generator` body param `auto_approve:true` → if `compliance_score >= MIN_COMPLIANCE (75)`, inserts with `status='approved'` + `reviewed_at=now()`. Else stays `draft`.

## Daily cap
`tiktok-render-orchestrator` enforces `DAILY_CAP=2` per persona per ET-day. Counts scripts in `['rendering','queued','posted']`. On hit: logs `daily_cap_hit`, exits clean, script stays `approved` for next slot.

## Pilot persona checklist (the_analyst)
Required on tiktok_accounts row before real posting:
- `tiktok_handle`, `blotato_account_id`, `heygen_avatar_id`
- `elevenlabs_voice_id` optional (defaults to George via DEFAULT_VOICE_BY_HOOK_STYLE.data_nerd)
- Flip `posting_active=true`, `auto_post_enabled=true`, `status='active'`

Other personas stay disabled until pilot proves loop.

## Content source dependency
`buildBriefs()` pulls from `bot_daily_picks` (today, status='locked') and `bot_daily_parlays` (yesterday, outcome won/lost). If both are empty the generator returns `briefs:0` — that's not a bug, the upstream pipelines simply haven't written content. Verify those tables before debugging the generator.
