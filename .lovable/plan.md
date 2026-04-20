

## Phase 2 Secrets — Plan

You have 3 keys ready (ElevenLabs, HeyGen, Pexels). Remotion worker isn't deployed yet, so we hold those 2 secrets until later.

### What I'll add now
- `ELEVENLABS_API_KEY` — narration TTS
- `HEYGEN_API_KEY` — avatar lip-sync video
- `PEXELS_API_KEY` — b-roll stock footage

### What we hold for later
- `REMOTION_WORKER_URL` — added once you deploy the `worker/` folder to Render/Railway
- `REMOTION_WORKER_SECRET` — generated when worker is deployed (shared secret between Lovable Cloud + worker)

### What works after this step
The orchestrator runs the first 3 stages of the pipeline:
1. Pulls approved script from queue
2. ElevenLabs → generates narration MP3 + word timings, uploads to `tiktok-renders` bucket
3. HeyGen → submits avatar job, polls until video ready, stores URL
4. Pexels → fetches b-roll clips per script beat, stores URLs
5. **Stops at compositing step** — logs "worker not configured, render paused"
6. Render row stays in `pending_compositing` status — admin UI shows assets ready, just no final MP4 yet

This means you can test/QA the audio + avatar + b-roll outputs in the admin UI before spending time on worker deploy. If the avatar voice or b-roll selection is off, we tune it without burning Remotion render minutes.

### Code change needed alongside the secrets
Update `tiktok-render-orchestrator/index.ts` to gracefully skip the worker dispatch when `REMOTION_WORKER_URL` is missing:
- Set render row to `status: 'assets_ready'`, `step: 'awaiting_worker'`
- Send Telegram alert: "Render assets ready for review, worker not deployed yet"
- Admin UI Queue tab gets a new "Preview assets" button that shows the audio player + avatar video + b-roll list

### Worker deploy (when you're ready, separate step)
1. Push `worker/` folder to a new GitHub repo
2. Connect to Render → New Web Service → Docker
3. Set worker env vars (`WORKER_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `STORAGE_BUCKET=tiktok-renders`)
4. Copy the Render URL → tell me, I add `REMOTION_WORKER_URL` + `REMOTION_WORKER_SECRET` to Lovable Cloud
5. Existing `assets_ready` renders auto-resume on next orchestrator run

### Next action
Approve this plan and I'll request the 3 secrets + add the graceful-skip code in the same step.

