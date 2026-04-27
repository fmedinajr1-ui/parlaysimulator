
# Plan — Fix alert variety + ship a Telegram explainer video

## Status checkpoint (end of session)

**Part A — DONE & LIVE.** Movement-free detectors deployed. First post-deploy run produced 6 take_it_now + 14 velocity_spike alerts; telegram broadcaster sent 20 mixed alerts to admin chat. Cron continues every 15 min.

**Part B — VIDEO RENDERED.** MP4 delivered to `/mnt/documents/slip-explainer.mp4` (4.8MB, 14.6s, 1080x1920, with Brian VO). Broadcast pipeline still TODO.

### Render notes (for future re-renders)
- Project at `/tmp/remotion-explainer/`. Composition id `main`, 480 frames @ 30fps.
- Sandbox ffmpeg lacks `libfdk_aac`, so render is two-step: `REMOTION_NO_AUDIO=1 node scripts/render-remotion.mjs /tmp/slip-explainer-noaudio.mp4` then `ffmpeg -i noaudio.mp4 -i public/voiceover.mp3 -c:v copy -c:a aac -shortest out.mp4`.
- Compositor binary patched: gnu variant overwritten with musl + ffmpeg/ffprobe symlinked from PATH.
- Known visual issue: Scene 1 phone mockup is washed out vs the bright radial bg (low contrast). Scenes 2/3/4 look great. To fix: darken the radial gradient further or replace Scene 1 bg with a solid `#02050d`.

### Remaining TODO for Telegram delivery
1. Storage bucket `marketing-videos` + tables `bot_video_broadcasts` / `bot_video_broadcast_recipients` already exist.
2. Build `explainer-video-render` edge function: upload `/mnt/documents/slip-explainer.mp4` to the bucket, return public URL. (For one-off, can also be done manually via storage_upload.)
3. Build `telegram-broadcast` edge function: sendVideo to admin first with inline "📣 Broadcast to all" callback button (`broadcast:<id>`).
4. Wire `broadcast:<id>` callback into `supabase/functions/telegram-prop-scanner/index.ts` (~line 490) to fan out to `bot_user_preferences.chat_id` (8 rows).

## Part A — Why you're only seeing cascade alerts (root cause + fix)

### What I confirmed in the data

- Last 24h alerts: **64 cascades, 0 take_it_now, 0 velocity_spike**.
- Snapshot table has 2,240 rows, but across 384 props with ≥3 snapshots each:
  - **0 props ever flipped sides**
  - **0 props ever moved composite by ≥12**
  - **avg `over_price` change = 0, avg `under_price` change = 0**
- `unified_props` is refreshed once per day (last write 09:00 UTC) and not re-priced intraday. There is no live FanDuel re-poll feeding it.
- `line_movements`, `juiced_prop_movement_history`, `odds_snapshots`, `extreme_movement_alerts` all have **0 rows in the last 24h** — so there is no other intraday price source to pivot to either.

### Conclusion

Cascade only needs the *current* distribution of derived sides — that fires fine. Take-It-Now (side flip vs. snapshot) and Velocity Spike (composite jump vs. baseline) **need price movement that doesn't exist** in our pipeline today. The detectors aren't broken; they're starved.

### Fix — three new detectors that work with the data we actually have

Rewrite `signal-alert-engine` with three new "movement-free" signals so users get a steady mix of alerts every cycle instead of just cascades:

1. **`take_it_now` — redefined as "Sharpest Side Asymmetry"**
   Trigger: a single prop with juice gap ≥ 30 American points (e.g. Over -105 / Under -135 → gap 30) AND it is the steepest gap in its game. Means the book is hammering one side. Confidence mapping unchanged (60–90 floor).

2. **`velocity_spike` — redefined as "Slate Outlier"**
   Trigger: a player's derived confidence is in the **top 5%** of all active props for the same `prop_type` and `sport` today AND ≥ 70. Means the slate is telling us this is a rare price. Computed across the live snapshot, no history needed.

3. **`cascade` — keep current logic** (≥3 same-team-same-direction). It works.

All three keep the **60% confidence floor** and 2-hour dedupe. Keep existing snapshot insert so when intraday pricing eventually exists, the *original* flip/velocity logic can be re-enabled without a rewrite (gate it behind a feature flag).

Result: every 15-min cycle should produce a balanced mix — cascades for crowd direction, take-it-now for sharp lines, velocity for slate-rare prices.

### Telegram delivery tweaks

Update `signal-alert-telegram` formatter to:
- Reflect the new definitions in the "why we're alerting" sub-line (so it reads honest: "Steepest juice gap on the slate" instead of "the model just flipped").
- Keep cascade message identical.
- Keep the 25-per-run cap and tipoff guard.

### Files touched (Part A)

- `supabase/functions/signal-alert-engine/index.ts` — rewrite take_it_now & velocity_spike detectors; preserve cascade + snapshot insert.
- `supabase/functions/signal-alert-telegram/index.ts` — update copy for the two redefined signal types.
- `mem://logic/betting/take-it-now-logic` and `mem://logic/betting/fanduel-signals` — note the new definitions so future changes don't undo this.

---

## Part B — "How to upload your slip" explainer video → Telegram

### What we'll ship

A **20-second 1080×1920 MP4** with **ElevenLabs voiceover** walking through the 3 steps: (1) snap/paste your slip → (2) AI scans & runs Monte Carlo → (3) get verdict + roast. Built with Remotion in the existing `worker/remotion/` setup, branded with the farm palette already in `src/components/farm/`.

### Storyboard (4 scenes, ~5 sec each)

```
Scene 1 (0-5s)   "Drop your slip"        — Phone mockup, screenshot drops in, shutter sound
Scene 2 (5-11s)  "We crunch the numbers" — 10,000 simulations counter, line chart sweeps
Scene 3 (11-17s) "Get the verdict"       — Big % win prob + roast bubble pops in
Scene 4 (17-20s) "Try it free"           — parlayfarm.com URL + Telegram bot handle
```

VO script (~55 words) generated via ElevenLabs (voice: Brian `nPczCjzI2devNBz1zQrb` — matches the farm tone). Audio stitched onto the Remotion timeline.

### Telegram delivery — admin-first with one-tap broadcast

Two new edge functions plus one tiny table:

1. **`explainer-video-render`** (one-time, on-demand)
   - Renders the MP4 locally inside the function via the existing `worker/` Remotion bundle.
   - Uploads to a new public Storage bucket `marketing-videos`.
   - Returns the public URL.

2. **`telegram-broadcast`** (the new generic sender)
   - Takes `{ video_url, caption, target: 'admin' | 'all' }`.
   - For `admin`: calls Telegram `sendVideo` to `TELEGRAM_CHAT_ID` and attaches an **inline keyboard button** "📣 Broadcast to all subscribers" with `callback_data=broadcast:<broadcast_id>`.
   - For `all`: loops over `bot_user_preferences.chat_id` (currently 8 rows), sends `sendVideo` to each, logs delivery per chat in a new `bot_video_broadcasts` table for dedupe + retry.

3. **`telegram-poll` (existing) → extend to handle `callback_query`**
   - When the admin taps the broadcast button, the callback hits the poll loop, which invokes `telegram-broadcast` with `target: 'all'` and the matching `broadcast_id`.
   - Edits the original admin message to show "✅ Sent to N subscribers".

`bot-send-telegram` stays untouched (it's text-only and admin-only by design). The new `telegram-broadcast` function adds video + multi-recipient capability without disrupting the rest of the alert pipeline.

### New table

```sql
create table public.bot_video_broadcasts (
  id uuid primary key default gen_random_uuid(),
  video_url text not null,
  caption text,
  created_by text default 'admin',
  status text not null default 'pending', -- pending | admin_sent | broadcast_sent
  admin_message_id bigint,
  recipients_total int default 0,
  recipients_succeeded int default 0,
  created_at timestamptz default now()
);
-- RLS: service_role only.
```

### Files touched (Part B)

- `worker/remotion/src/compositions/SlipExplainer.tsx` — new 4-scene composition.
- `worker/remotion/src/Root.tsx` — register the new composition.
- `supabase/functions/explainer-video-render/index.ts` — new (renders + uploads).
- `supabase/functions/telegram-broadcast/index.ts` — new (sendVideo, admin/all targeting, callback handling).
- `supabase/functions/telegram-poll/index.ts` — extend to route `callback_query` → `telegram-broadcast`.
- `supabase/migrations/<ts>_bot_video_broadcasts.sql` — new table + RLS.
- Storage: create public `marketing-videos` bucket via migration.

### Verification before delivery

1. Render the MP4 locally, save to `/mnt/documents/slip-explainer.mp4`, return as a `<lov-artifact>` so you can preview it before any Telegram send.
2. Once you approve the cut, trigger `explainer-video-render` to upload it and `telegram-broadcast` with `target: 'admin'`. You'll see it on your Telegram with the broadcast button.
3. Tapping the button fans it out to the 8 chat_ids in `bot_user_preferences`.

---

## Open question I'm assuming "yes" on

The 8 chat_ids in `bot_user_preferences` are unverified (none completed onboarding). I'll send to all of them — if any are stale/blocked, the broadcast log will mark them failed but the run won't crash. If you'd rather restrict to onboarded-only or a manual allowlist, say so before approving.

