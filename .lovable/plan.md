

The user already approved the plan with their preferences (15/day, hybrid auto-publish with flag-for-review, content guardrails covering winning/AI/stats/cheating/rigged/player updates/injuries/rankings/L10/MVP). Looking at the codebase, the system is already built — `generate-blog-post` edge function exists with the right prompt covering those exact topics, `AdminBlog.tsx` is in place, the topics queue has 124 seeded topics matching the guardrails, and the cron is scheduled.

So this is essentially a confirmation/refresh task. Let me present a tight plan that:
1. Confirms what's already wired
2. Adjusts the cron from 16/day to exactly 15/day
3. Adds the missing pieces I'd want before declaring "done"

Keep this concise — the heavy lifting is done.

# Blog System Status + Final Tightening

The full system is already built and live from your prior approval. Here's what exists vs. what I'll tighten now.

## Already live
- `/blog`, `/blog/[slug]`, `/blog/category/[cat]` routes with full SEO (Article + Breadcrumb + FAQ JSON-LD, OG, Twitter cards, canonical → parlayfarm.com)
- `/admin/blog` manager (filter, publish toggle, delete, "Generate Now" button)
- `generate-blog-post` edge function with your guardrails baked into the system prompt (winning, AI, stats, rigged-line analysis, player updates, injuries, MVP, L10, rankings)
- `blog-sitemap` + `blog-rss` edge functions
- 124 seeded topics across Strategy, AI Picks, Prop Analysis, NBA, MLB, Tennis, MMA
- Quality gate: <800 words OR <3 internal links → flagged (matches your hybrid choice)
- Cron currently runs 16x/day at `0,36 0,3,6,9,12,15,18,21 * * *`

## What I'll change in this pass

1. **Tighten cron to exactly 15/day** — switch to every ~96 minutes via `0 */1 * * *` filtered, or simpler: `13,49 0,3,6,9,12,15,18 * * * + 0 22 * * *` = 15 runs. Cleanest pattern that hits 15: every ~96 min using a 15-slot map.
2. **Add internal `/blog` link to your main nav** so visitors actually find it (currently no link from homepage → blog = wasted SEO).
3. **Add `/blog` to footer** of bot-landing page.
4. **Refill topic queue** — add 60 more topics so we don't run out in ~8 days.
5. **Fix robots.txt sitemap URL** — currently points to the supabase functions URL. I'll add a clean rewrite hint and also keep the working URL.

## What I will NOT touch
- The generation prompt (already covers all your guardrails)
- Quality gate thresholds (already hybrid)
- Existing routes/admin (working)

## Files touched
- `src/components/Header.tsx` (or equivalent nav) — add Blog link
- `src/components/bot-landing/Footer.tsx` (or equivalent) — add Blog link  
- DB: reschedule cron + insert ~60 more topics
- `public/robots.txt` — keep current sitemap URL (only working option for SPA hosting)

## After approval
I'll also trigger 2-3 immediate generations so the `/blog` page isn't empty when visitors land.

