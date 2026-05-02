## Plan: Fully autonomous TikTok daily generation (1 account, 2 posts/day)

### Goal
Pick **one** persona (recommend `the_analyst`), wire it end-to-end so 2 videos/day generate, render, and post to TikTok via Blotato — zero manual touches. Prove the loop works, then clone to other accounts.

---

### Phase 1 — Pick & configure the pilot account

You need to provide 4 IDs for `the_analyst` (or whichever persona you pick). I'll update the `tiktok_accounts` row with:

| Field | Where to get it |
|---|---|
| `tiktok_handle` | Your TikTok @ handle |
| `blotato_account_id` | Blotato dashboard → Accounts → copy ID |
| `heygen_avatar_id` | HeyGen → Avatars → pick one, copy ID |
| `elevenlabs_voice_id` | (optional — defaults to George if blank) |

Then flip `posting_active=true`, `auto_post_enabled=true` for that one row. The other 2 stay disabled.

---

### Phase 2 — Add auto-approval to script generator

Modify `tiktok-script-generator/index.ts`:
- Add `auto_approve` body param (default `false` for backward compat)
- When `auto_approve=true` AND safety lint passes (`compliance >= 75`): set `status='approved'` directly instead of `'draft'`
- Log auto-approval event to `tiktok_pipeline_logs`

This keeps the manual flow intact for other personas; only the cron will pass `auto_approve=true`.

---

### Phase 3 — Two new cron jobs

**Cron A: Daily generator** — runs twice daily at 8am & 4pm ET (12:00 & 20:00 UTC)
```
0 12,20 * * * → POST tiktok-script-generator
  body: { persona_key: "the_analyst", auto_approve: true, count: 1 }
```

**Cron B: Render pickup** — runs every 10 min, processes approved scripts
```
*/10 * * * * → POST tiktok-render-orchestrator (no body = pick next approved)
```

The existing `tiktok-blotato-cron-every-minute` already handles the final post step.

---

### Phase 4 — Safety guardrails

- **Daily cap**: render orchestrator checks `tiktok_posts` count for the persona today. If ≥2, skip with `daily_cap_hit` log entry.
- **Failure alerts**: if any pipeline step errors, send admin Telegram notification (uses existing `bot-send-telegram`).
- **Account self-pause**: if 3 consecutive renders fail for a persona, auto-flip `auto_post_enabled=false` and Telegram alert.

---

### Phase 5 — Admin UI surface

Add a small status panel in the existing TikTok admin Publish tab showing:
- Today's generation status per persona (Generated / Rendering / Posted / Failed)
- Next scheduled run time
- Quick toggle: "Pause daily auto-gen" per account

---

### Pipeline flow (after build)

```text
8am ET cron        → script-generator (auto_approve)
                       ↓
                     status='approved' in tiktok_video_scripts
                       ↓
every 10min cron   → render-orchestrator → ElevenLabs → HeyGen → Pexels → Worker
                       ↓
worker callback    → render-callback → enqueue in tiktok_post_queue
                       ↓
every 1min cron    → blotato-cron → posts to TikTok
                       ↓
every 6h cron      → metrics-sync → pulls views/likes back
```

---

### What I need from you to start
**Just one thing**: which persona to pilot (`the_analyst` / `the_edge` / 3rd one) and the 3 IDs for it. You can drop them now or after I deploy the infrastructure.

If you want to test the loop without real posting first, I can also add a **`dry_run=true` flag** that skips the actual Blotato upload and logs what would have been posted. Say the word.
