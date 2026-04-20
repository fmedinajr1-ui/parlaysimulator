

## TikTok Pipeline — Phases 3, 4 & 5 Plan

Phases 1 & 2 are live (script gen, safety, ElevenLabs + HeyGen + Pexels orchestration, asset preview UI). The Remotion worker is scaffolded but not deployed yet. We're ready to build out the rest.

---

### Phase 3 — Posting & Manual Download (no posting service needed)

You said you don't have a posting service. So Phase 3 is **manual-first**: the admin UI becomes a content delivery dashboard. Once a render is finished (or you composite externally), you download the MP4, caption, and hashtags as one bundle, then post manually.

**What I'll build:**

1. **Caption + hashtag generator** — new edge function `tiktok-caption-generator`
   - Input: completed script row
   - Uses Lovable AI Gateway (no key needed)
   - Persona-aware, uses `caption_template` + `baseline_hashtags` from `tiktok_accounts`
   - Stores output on the script row (`final_caption`, `final_hashtags`)
   - Auto-runs when render completes (called from `tiktok-render-callback`)

2. **DB additions**
   - `tiktok_posts` table already exists (Phase 1) — add columns: `posted_manually_at`, `manual_post_url`, `view_count_snapshot`, `last_metrics_check_at`
   - New table `tiktok_post_schedule` — slots per account (day-of-week + hour-of-day) so the admin sees "next slot for The Analyst: Tue 7pm"

3. **Admin UI — new "Publish" tab**
   - Lists `assets_ready` + `completed` renders
   - One-click **Download bundle**: zips MP4 + caption.txt + hashtags.txt + thumbnail.jpg
   - **Mark as posted** button → opens modal for TikTok URL paste, marks `tiktok_posts` row, sets `posted_manually_at`
   - Shows next recommended posting slot per account

4. **Telegram alert flow**
   - "Render complete — download bundle" with deep link to `/admin/tiktok?tab=publish`
   - "Slot reminder" — 30 min before scheduled slot, ping admin if there's an unposted render

**No external posting API needed** — when you sign up for Blotato/Postiz/Buffer later, we add a "Push to scheduler" button alongside "Mark as posted".

---

### Phase 4 — Learning Loop (closes the feedback cycle)

This is what makes the bot smarter over time. You manually paste TikTok metrics (views, watch time, likes) into the admin UI, and the system learns which hooks/templates work for each persona.

**What I'll build:**

1. **DB additions**
   - `tiktok_post_metrics` — time-series snapshots: `post_id`, `recorded_at`, `views`, `likes`, `comments`, `shares`, `avg_watch_time_sec`, `completion_rate`
   - Compute `viral_score` = views per hour since posting

2. **Edge function `tiktok-metrics-processor`** (manual + cron)
   - Recomputes `tiktok_hook_performance.avg_completion_rate` + `avg_views` from posted videos
   - Promotes hooks with >55% completion → `is_winning_hook = true` (used more in generator)
   - Demotes hooks with <30% completion + 5+ uses → `active = false`
   - Writes daily summary to `tiktok_pipeline_logs`

3. **Admin UI — enhanced "Hook Lab" tab**
   - Quick-paste form: "Post URL → Views → Watch time → Likes" → 4 inputs, autopopulates rest
   - Performance heatmap: which hook style × template combo wins per persona
   - "Generate variants" button — takes a top-performing hook, asks AI to write 3 variations, drops them into hook library as `origin: 'learned'`

4. **Weekly digest Telegram alert**
   - Sunday 8pm ET: "Top hook this week: 'The numbers on Jokic are strange.' (62% completion, 14k avg views). Worst: ... Suggest retiring 3 hooks?"

---

### Phase 5 — Worker Deploy (when you're ready)

This is the **only step that requires you to do work outside Lovable**. I'll prep everything so deployment is copy/paste.

**What I'll do (in Lovable):**
1. Add a `worker/DEPLOY.md` with exact step-by-step Render.com instructions, screenshots-described
2. Create a `worker/test-job.json` with a real script payload so you can curl-test the worker before connecting it
3. Add an admin UI button "Re-dispatch awaiting_worker renders" that re-runs orchestrator on the queue once `REMOTION_WORKER_URL` is set

**What you do:**
1. Push `worker/` to a new GitHub repo (one command, I'll provide it)
2. Render.com → New Web Service → Docker → point to repo
3. Set 4 env vars (I'll give exact values)
4. Copy URL back to me
5. I add `REMOTION_WORKER_URL` + `REMOTION_WORKER_SECRET` to Lovable Cloud
6. Click "Re-dispatch" → existing assets-ready renders all complete

Total time: ~15 min for you, free tier on Render.

---

### Suggested execution order

| Step | Phase | Why first |
|---|---|---|
| 1 | Phase 3 | Lets you actually use the system end-to-end (download → post → mark posted) without worker. Highest immediate ROI. |
| 2 | Phase 4 | Once you have a few posts logged, the learning loop has data to work with. |
| 3 | Phase 5 | Deploy worker only after you've validated 5-10 scripts get good engagement. No point compositing if the scripts aren't landing. |

This ordering means **you can start posting tomorrow** with manually composited videos (or even just the avatar + audio + b-roll links from the Renders tab) while the worker waits.

---

### Approve and I'll start with Phase 3

I'll build all of Phase 3 in one step: caption generator function, DB migration, Publish tab UI, ZIP bundle download, manual-post modal, scheduling slots.

