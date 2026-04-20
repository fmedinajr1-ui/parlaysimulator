# Worker Deploy — Step-by-Step (Render.com, ~15 min)

This is the **only thing in the TikTok pipeline that runs outside Lovable**.
Remotion needs Chromium + ffmpeg + a real Node process — Lovable Cloud edge
functions can't host that. So we ship the `worker/` folder to Render.com (free
tier) and Lovable Cloud calls it over HTTPS.

When this is done, the orchestrator will stop parking renders in
`awaiting_worker` and start producing real MP4s.

---

## 1. Push `worker/` to its own GitHub repo

From your local machine (or GitHub web UI):

```bash
# Option A — local clone of the Lovable repo
cd worker
git init
git add .
git commit -m "initial worker"
gh repo create my-tiktok-worker --private --source=. --push

# Option B — copy the worker/ folder into a fresh empty repo on github.com
# and push it as the root.
```

The repo only needs the contents of `worker/` — `Dockerfile`, `package.json`,
`src/`, `remotion/`. Don't include the rest of the Lovable project.

## 2. Create the Render service

1. Go to https://render.com → **New** → **Web Service**
2. Connect the GitHub repo from step 1
3. **Runtime**: Docker (it auto-detects the Dockerfile)
4. **Region**: pick the one closest to Lovable Cloud (us-east is fine)
5. **Instance Type**: **Free** is enough to start — upgrade to Starter ($7/mo)
   if you render more than ~30 videos/day
6. **Health Check Path**: `/health`

## 3. Set 4 environment variables

In the Render service → **Environment**:

| Key | Value |
|---|---|
| `WORKER_SECRET` | Generate a random 32+ char string (`openssl rand -hex 32`). **Save this** — you'll paste it back into Lovable Cloud in step 5. |
| `SUPABASE_URL` | `https://pajakaqphlxoqjtrxzmi.supabase.co` |
| `SUPABASE_SERVICE_ROLE` | Get from Lovable → Backend → Settings → API → `service_role` key |
| `STORAGE_BUCKET` | `tiktok-renders` |

## 4. Deploy + smoke test

Render will build the Docker image (~3-5 min first time, ~30s after). When
the service shows **Live**, copy the URL — it'll look like
`https://my-tiktok-worker.onrender.com`.

Test it from your terminal:

```bash
curl https://my-tiktok-worker.onrender.com/health
# → {"ok":true,"ts":1730000000000}
```

If you see `{ok: true}`, the worker is up.

## 5. Tell Lovable the worker URL

Reply in Lovable chat with:

> "Worker is up at https://my-tiktok-worker.onrender.com — secret is `<the WORKER_SECRET from step 3>`"

I'll add `REMOTION_WORKER_URL` and `REMOTION_WORKER_SECRET` to Lovable Cloud
secrets, then click **Re-dispatch awaiting renders** in `/admin/tiktok` →
Renders tab. All scripts that were stuck at `awaiting_worker` will composite
within 1-3 min each.

---

## Test the full render path before going live

After step 5, run this from your terminal to do a real render against the worker:

```bash
curl -X POST https://my-tiktok-worker.onrender.com/render \
  -H "Authorization: Bearer <WORKER_SECRET>" \
  -H "Content-Type: application/json" \
  -d @worker/test-job.json
# → {"job_id":"<uuid>"}
```

Watch Render's logs — you should see:
- `[worker] listening on :8787`
- `Bundling Remotion project...`
- `Rendering frames...`
- POST to the callback URL → 200

Then check Lovable Cloud → `tiktok_video_renders` table — the test render
row should flip to `status=completed` with a `final_video_url`.

## Troubleshooting

**Render build fails on `chromium`**: Render's free instances sometimes hit
memory limits during Docker build. Upgrade to Starter ($7/mo, 512MB → 2GB)
and re-deploy.

**Worker returns 401**: `WORKER_SECRET` doesn't match what's in Lovable Cloud.
Re-copy it (no quotes, no trailing newline).

**Worker times out (>600s)**: A single render is taking too long. Check the
Render logs — usually means the audio is unexpectedly long, or the b-roll URLs
are slow to download. Bump Render's instance to Starter for more CPU.

**Renders complete but don't appear in admin UI**: The callback URL may be
wrong. Check `tiktok-render-orchestrator` env — `SUPABASE_URL` should match
this project. Look at `tiktok-render-callback` edge function logs in Lovable.

---

## Optional: pin worker uptime

Render's free tier sleeps after 15 min of inactivity, which adds ~30s cold
start to the first render. If that bothers you:

- Upgrade to Starter ($7/mo, never sleeps), **or**
- Add a free uptime monitor (e.g. UptimeRobot) hitting `/health` every 5 min
