# TikTok Remotion Worker

External Node service that does the heavy compositing the Lovable Cloud edge
functions cannot do (Remotion needs Chromium + ffmpeg). The Lovable side
handles ElevenLabs (audio), HeyGen (avatar), and Pexels (b-roll), then sends
a render job here.

## Contract

### POST `/render`  (called by `tiktok-render-orchestrator`)

```jsonc
{
  "render_id": "uuid",                     // matches tiktok_video_renders.id
  "script_id": "uuid",
  "composition": "PickReveal" | "ResultsRecap" | "DataInsight",
  "callback_url": "https://<project>.supabase.co/functions/v1/tiktok-render-callback",
  "callback_secret": "<REMOTION_WORKER_SECRET>",
  "props": {
    "script": { /* full VideoScript row */ },
    "audioUrl": "https://...signed.../audio.mp3",
    "audioTimings": [ { "word": "...", "start_sec": 0.1, "end_sec": 0.4 }, ... ],
    "audioDurationSec": 28.5,
    "avatarVideoUrl": "https://...heygen.../video.mp4" | null,
    "brollUrls": [ { "beat_index": 1, "url": "https://...pexels.../video.mp4" } ]
  }
}
```

Worker responds **immediately** with `{ "job_id": "<worker-job-id>" }` and
continues compositing in the background.

### POST `<callback_url>`  (called by worker when finished)

```jsonc
{
  "render_id": "uuid",
  "status": "completed" | "failed",
  "final_video_path": "renders/<render_id>.mp4",   // path inside tiktok-renders bucket
  "thumbnail_path":   "renders/<render_id>.jpg",   // optional
  "error": "...",                                  // when failed
  "cost_usd": 0.04
}
```

Auth: `Authorization: Bearer <callback_secret>` header. Lovable Cloud verifies
against `REMOTION_WORKER_SECRET`.

## Deploy

Deploy to Render, Railway, or Fly. Cheapest path: **Render web service, free
tier**, ~$0/mo while you're under 750 hours.

1. Push the `worker/` directory to its own GitHub repo.
2. On Render: New → Web Service → Docker → root = `worker/`.
3. Set env vars:
   - `WORKER_SECRET`            — must equal Lovable Cloud `REMOTION_WORKER_SECRET`
   - `SUPABASE_URL`             — same as Lovable Cloud SUPABASE_URL
   - `SUPABASE_SERVICE_ROLE`    — service role for storage uploads
   - `STORAGE_BUCKET`           — `tiktok-renders`
4. Copy the Render URL → set `REMOTION_WORKER_URL` in Lovable Cloud secrets.

## Local dev

```bash
cd worker
npm install
npm run dev   # listens on :8787
```

Test with:

```bash
curl -X POST http://localhost:8787/render \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer testsecret" \
  -d @sample-job.json
```

## Architecture

```
 Lovable Cloud edge fn ──▶ POST /render ──▶ Worker (Node + Remotion)
         ▲                                         │
         │                                         │ composite (1-3 min)
         │                                         ▼
         └────────── POST /callback ◀───── upload MP4 to tiktok-renders bucket
```

The Remotion compositions live in `remotion/` (PickReveal, ResultsRecap,
DataInsight). They're standard React + Remotion components — copy-pasted from
the source ZIP without modification.