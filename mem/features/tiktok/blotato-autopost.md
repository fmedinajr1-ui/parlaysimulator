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

## Content sources (priority order)
1. **`pick_reveal`** — uses today's `bot_daily_picks` (status='locked'). Currently empty long-term; engine that should populate it isn't wired.
2. **`results_recap`** — uses yesterday's `bot_daily_parlays` (outcome won/lost). Currently dry because settlement of parlays is stalled.
3. **`streamer_promo`** (always-on fallback) — UGC streamer-style ParlayFarm promo. No data dependency. `buildBriefs()` always emits one per persona per day if neither pick_reveal nor results_recap fired. Angles rotate from a hard-coded list inside `buildBriefs()`. Hooks live in `tiktok_hook_performance` (style='data_nerd', template='streamer_promo'). Compliance lint applies.

The template CHECK constraints on `tiktok_hook_performance.template` and `tiktok_video_scripts.template` were extended to include `streamer_promo` in 2026-05-15.
