

# SEO Blog + Auto-Generated Content

## Reality check
- **Backlinks** = OTHER sites linking to yours. Can't create those from inside the app. We CAN build the *target* (quality blog on parlayfarm.com) so people link to it, plus the SEO infra Google needs to rank it.
- **50 posts/day** = 1,500/month. Google's Helpful Content system will demote low-quality AI farms. I'll add a quality gate (min 800 words, unique angle, internal links) so they actually rank instead of getting deindexed.
- **Hashtags** don't do anything on a blog (social-only). I'll use proper meta tags + JSON-LD schema instead — that's what Google reads.

## What I'll build

### 1. Blog routes
- `/blog` — index with category filters (Strategy, AI Picks, Prop Analysis, NBA, MLB, Tennis, MMA)
- `/blog/[slug]` — article page with `Article` JSON-LD, OG/Twitter cards, breadcrumbs, FAQ schema
- `/blog/category/[cat]` — category archive
- `/sitemap.xml` — dynamic, regenerates on publish
- `/rss.xml` — RSS feed (helps discovery + syndication)
- Update `robots.txt` to reference sitemap

### 2. Database (Lovable Cloud)
- `blog_posts` — slug, title, meta_description, body_md, category, tags[], hero_image_url, published_at, status, word_count
- `blog_topics_queue` — title_seed, category, target_keyword, used_at — pre-seeded with ~500 topic ideas
- RLS: public read on `status='published'`, admin-only write

### 3. Auto-generator edge function (`generate-blog-post`)
- Cron-triggered at chosen cadence
- Pulls next topic from queue
- Calls Lovable AI (`google/gemini-2.5-flash`) with structured prompt:
  - 1000-1500 words, H2/H3 structure
  - 3-5 internal links to /bot, /scout, /upload, /best-bets (passes link equity to signup pages)
  - 2-3 outbound links to ESPN/Action Network (topical authority signal)
  - Meta description, focus keyword, FAQ section
- Optional hero image via `google/gemini-3.1-flash-image-preview`
- Quality gate: rejects if < 800 words or duplicate slug

### 4. SEO essentials
- JSON-LD: `Article`, `BreadcrumbList`, `FAQPage`
- Canonical URLs → parlayfarm.com
- Auto `<meta>` tags from post fields
- Internal link injection (every post links to product pages)
- IndexNow ping on publish (instant Bing/Yandex indexing)

### 5. Admin page (`/admin/blog`)
- List, edit, unpublish, regenerate
- "Run generator now" button
- Topic queue manager

## What I CAN'T do (be honest)
- Make other sites link to you — that's outreach work
- Guarantee Google ranks AI content — quality gate helps but isn't magic
- Hashtags on a blog do nothing for SEO

## Three quick decisions before I build

1. **Volume**: 5/day (safest for ranking), 15/day (balanced), or 50/day (your ask, with strict quality gate)?
2. **Workflow**: Auto-publish, drafts-for-review, or hybrid (auto-publish good ones, flag weak ones)?
3. **Content guardrails**: Anything to always include (e.g. plug the bot) or avoid (e.g. addiction jokes, specific competitors)?

Reply with your choices and I'll build it.

