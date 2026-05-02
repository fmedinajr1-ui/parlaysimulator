## Plan: Wire up `the_analyst` pilot account

### IDs to plug in

| Field | Value |
|---|---|
| `tiktok_handle` | `@crackdatjackpot` |
| `blotato_account_id` | `blt_rkJh4iWrVQYtx/1QKoScBgg/v+7IAgKQvhCenv10p2Q=` |
| `heygen_avatar_id` | `1734725590` (extracted from the URL you pasted) |
| `elevenlabs_voice_id` | `xpnPINZfvvstD607nURI` |

### ⚠️ Confirm before I run
**HeyGen avatar ID**: You pasted `https://app.heygen.com/avatars/looks/public?avatarId=1734725590`. I'll use `1734725590` as the avatar ID. If HeyGen's API actually expects a different format (e.g. a UUID or `avatar_id` from API list), the renders will fail and we'll catch it on first run.

### Steps

1. **Update DB row** for `the_analyst`:
   ```sql
   UPDATE tiktok_accounts SET
     tiktok_handle = '@crackdatjackpot',
     blotato_account_id = 'blt_rkJh4iWrVQYtx/1QKoScBgg/v+7IAgKQvhCenv10p2Q=',
     heygen_avatar_id = '1734725590',
     elevenlabs_voice_id = 'xpnPINZfvvstD607nURI',
     posting_active = true,
     auto_post_enabled = true,
     status = 'active'
   WHERE persona_key = 'the_analyst';
   ```
   Other 2 personas stay disabled.

2. **Verify required secrets** exist (BLOTATO_API_KEY, HEYGEN_API_KEY, ELEVENLABS_API_KEY, PEXELS_API_KEY, REMOTION_WORKER_SECRET). Flag any missing.

3. **Verify cron jobs are live**: query `cron.job` to confirm `tiktok-daily-generator-the-analyst` (8am/4pm ET) and `tiktok-render-pickup-every-10min` are scheduled.

4. **Smoke test (manual fire)**: trigger `tiktok-script-generator` once with `{persona_key:"the_analyst", auto_approve:true}` to:
   - confirm a script lands with `status='approved'` and `compliance_score >= 75`
   - watch the next 10-min cron pick it up → render orchestrator → ElevenLabs → HeyGen → Pexels → worker → callback → Blotato post
   - tail edge function logs at each step

5. **Report back**: tiktok URL of the first auto-posted video, total pipeline cost, any failures with the specific step that broke.

### If anything fails
- HeyGen 4xx on avatar → ask you to grab the avatar ID from HeyGen's API listing instead of the public URL
- Blotato 4xx on accountId → re-check the format (the `=` and `/` chars look base64; should be safe but worth confirming Blotato accepts it raw)
- Worker render timeout → check `worker/` deployment is live and `REMOTION_WORKER_SECRET` matches

Approve and I'll execute steps 1–5 in order.
