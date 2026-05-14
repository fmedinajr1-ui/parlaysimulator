# Internal Linking for SEO — Blog Discovery

Goal: give crawlers more paths into our **free** blog content (181 posts across 7 categories) without exposing any paywalled pages (`/dashboard`, `/sweet-spots`, `/team-bets`, `/scan`, `/manual`, `/live-ai`, `/profit-plan`, `/scout`).

## Changes

### 1. `FarmNav.tsx` (sitewide top nav, Home page)
Add a `Blog` link next to `Sharp Tracker` / `The Farm` / `Pricing`. Highest-value crawl signal — every page links to /blog.

### 2. `FarmFooter.tsx` (sitewide footer, Home page)
Add a "Read the Blog" column with anchor links to each category hub:
- `/blog` (All Articles)
- `/blog/category/strategy` (58 posts)
- `/blog/category/ai-picks` (49 posts)
- `/blog/category/nba` (28 posts)
- `/blog/category/prop-analysis` (20 posts)
- `/blog/category/mlb` (14 posts)
- `/blog/category/mma`, `/blog/category/tennis` (5 each)

Gives every visitor + crawler 8 outbound links to blog hubs.

### 3. `Home.tsx` — new "Latest from the Blog" section
Insert a section above `FinalCTA` that fetches the 6 most recent published posts and renders them as cards linking to `/blog/{slug}`, plus a "View all articles →" link to `/blog`. Uses the existing farm card styling. This puts 7 fresh blog links on the highest-traffic page.

### 4. `BlogPost.tsx` — Related Articles + clickable category
Two additions at the bottom of each article (above the existing CTA):
- Make the category `<Badge>` at the top a `<Link>` to `/blog/category/{slug}` (currently static).
- New "Related articles" section: query 3 other published posts in the same category (excluding current), render as compact cards linking to `/blog/{slug}`.

This turns each of 181 posts into a hub linking to 4 sibling posts + its category.

### 5. `BlogIndex.tsx` — clickable category badges on cards
Wrap each card's category `<Badge>` in a `<Link>` to `/blog/category/{slug}` (currently the whole card links to the post; nest a stopPropagation link for the badge). Adds 60 category links from the index page.

### 6. `BlogCategory.tsx` — sibling category nav
Add a horizontal "Browse other categories" row at the bottom linking to the other 6 category hubs. Helps crawlers discover sibling hubs from any category page.

## Out of scope (intentionally)
- No links added pointing to `/dashboard`, `/sweet-spots`, `/team-bets`, `/scan`, `/manual`, `/live-ai`, `/profit-plan`, `/scout`, `/bot-pipeline`, `/bot-success` from any new surface — these stay behind the existing CTAs only.
- The existing "Try the Bot" CTA on BlogPost stays as-is (already there, points at `/bot` which redirects to `/`).
- No content/markdown changes inside posts.
- No new routes; sitemap already covers `/blog`, categories, and all post slugs.

## Technical notes
- Blog data lives in Supabase `blog_posts` (status='published'). Related-posts query: `.eq('category', post.category).neq('id', post.id).order('published_at', desc).limit(3)`.
- All links use `react-router-dom` `<Link>` so they're real `<a href>` tags for crawlers.
- Category slug derivation matches existing `BlogCategory.tsx` map (`category.toLowerCase().replace(/\s+/g, '-')`).
- No design-system token violations — reuse existing `Card`, `Badge`, farm tokens.
