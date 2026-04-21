

## Fix admin access + Phase 7 plan

### Part A — Make `/admin/tiktok` reachable

Two small fixes so you stop getting lost:

1. **Add a "TikTok Pipeline" tile on `/admin`** — alongside the other admin section cards in `src/pages/Admin.tsx`. Click → navigates to `/admin/tiktok`. Only shown to admins (already gated by the page itself).
2. **Sign-in reminder**: you're currently on `/admin-login`. After you sign in with the admin account, the route will load. (No code change — just confirming.)

### Part B — Phase 7: Analytics + Auto-Winner A/B Testing

Closes the loop: posts go out via Blotato (Phase 6) → metrics roll in → winners feed back into the script generator's hook scoring (Phase 4 already has `tiktok_hook_performance`, we extend it).

**1. Metrics ingestion** — `tiktok-metrics-sync` edge function (cron every 6h)
- For each row in `tiktok_posts` with a Blotato post id and `posted_at` within last 14 days, GET `/v2/posts/{id}/analytics` from Blotato.
- Upsert `views, likes, comments, shares, completion_rate, viral_score` into `tiktok_posts`.
- Recompute `tiktok_hook_performance` rollups (avg completion, avg viral score, sample size per hook template).

**2. A/B persona testing** — new flow on the Publish tab
- New button "Run A/B test" on any approved script: clones the script, regenerates assets under a second persona, queues both to post in adjacent slots tagged with a shared `ab_group_id` (new column on `tiktok_post_queue`).
- New edge function `tiktok-ab-resolver` (cron daily): for each `ab_group_id` ≥ 48h old, compares `viral_score`, marks winner, increments `wins`/`losses` on `tiktok_personas`, and writes the winning hook back to `tiktok_hook_performance` with a +5% confidence boost.

**3. Analytics dashboard** — new "Analytics" tab on `/admin/tiktok`
- KPI cards: 7d/30d total views, avg completion, top persona, top hook.
- Charts (recharts, already in project): views per day stacked by persona, completion rate trend, hook leaderboard table with sample size.
- A/B results table: group id, both personas, both viral scores, winner badge, hook used.

**4. Feedback into script generator**
- `tiktok-script-generator` already reads `tiktok_hook_performance`; we just bias its hook selection by `avg_completion_rate * log(sample_size+1)` so winners get used more, with a 10% epsilon-greedy exploration rate so new hooks still get tried.

### Schema changes

```sql
alter table tiktok_post_queue add column ab_group_id uuid;
alter table tiktok_posts add column ab_group_id uuid,
  add column completion_rate numeric, add column viral_score numeric,
  add column metrics_synced_at timestamptz;
alter table tiktok_personas add column wins int default 0,
  add column losses int default 0;
create index on tiktok_posts (ab_group_id) where ab_group_id is not null;
```

### Files

- `src/pages/Admin.tsx` — add TikTok tile
- `src/pages/admin/AdminTikTok.tsx` — add Analytics tab, A/B button wiring
- `src/components/admin/tiktok/AnalyticsTab.tsx` (new) — KPI cards + charts + leaderboard + A/B table
- `src/components/admin/tiktok/PublishTab.tsx` — "Run A/B test" button on approved scripts
- `supabase/functions/tiktok-metrics-sync/index.ts` (new) — Blotato analytics → DB
- `supabase/functions/tiktok-ab-resolver/index.ts` (new) — pick winners, update personas
- `supabase/functions/tiktok-script-generator/index.ts` — bias hook selection, add epsilon-greedy
- New migration for the columns above + cron schedules for the two new functions

### Out of scope (saved for Phase 8)

Comment/reply automation, TikTok DM auto-responder, multi-platform fan-out (IG Reels/Shorts).

### Approve to start

I'll do Part A (admin tile) and Part B (Phase 7) in one implementation pass.

