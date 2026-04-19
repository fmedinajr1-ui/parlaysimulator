

User picked the Free Slip Grader 2.0 funnel. Let me check what already exists so I scope this right.

What I know from the codebase scan:
- `HomepageAnalyzer` exists on Index.tsx — already grades slips
- `/upload` page is the deeper analyzer flow with `QuickCheckResults` (safe/caution/danger + sharp signals)
- `SmartAnalyzeButton` with role-aware engines
- Bot landing page with `PricingSection` ($99/mo Telegram bot)
- Lovable Cloud is enabled — auth, DB, edge functions, AI gateway available
- Voice/humor system already built in edge functions (voice.ts) — can reuse the personality for grader copy

What's missing that I need to build:
1. A dedicated `/grade` landing page (separate from `/upload`) with the right hook framing
2. A grading rubric that returns A/B/C/F + brutal one-liner (not just safe/caution/danger)
3. Shareable image card generation (canvas → PNG)
4. Email capture wall before showing the grade detail (or after preview)
5. `email_subscribers` table
6. Daily pick drip — edge function that sends 1 free pick/day for 7 days to email subs
7. Email sending infra (need to set up email domain + Lovable Emails)

Email setup is the gating dependency. They have custom domains (parlaysimulator.com, parlayfarm.com) but no email domain configured yet. I'll need to trigger the setup dialog.

# Free Slip Grader 2.0 — Build Plan

## The funnel

```
Twitter/SEO traffic → /grade landing page
  → "Paste your slip. We'll tell you why it'll lose."
  → Grade preview (letter + headline) shown immediately
  → Email gate: "Want the full breakdown + 7 days of free picks?"
  → Email captured → full grade revealed + share card generated
  → 7-day daily pick email drip
  → Day 7: upgrade CTA → $99/mo Telegram bot
```

## What I'll build

### 1. New page: `/grade` (Free Slip Grader)
- Hero: **"Paste your slip. We'll tell you why it'll lose."** (brutal-honest brand voice)
- Reuses the existing slip parser from `HomepageAnalyzer` / `/upload`
- Inputs: paste text OR upload screenshot OR enter legs manually
- Shows partial grade immediately (letter + 1-line verdict, no detail)
- Email gate appears for full breakdown

### 2. New edge function: `grade-slip`
- Takes parsed legs → returns:
  - `letter_grade`: A / B / C / D / F
  - `headline`: bot-personality one-liner ("This is a coin flip wearing a tuxedo.")
  - `breakdown`: per-leg analysis (locked behind email)
  - `share_card_data`: the data needed to render the PNG
- Uses existing analyzer engines + voice.ts humor lines for grading copy
- Grading rubric: composite of confidence, edge%, sharp signals, correlation, leg count

### 3. Share card generator
- New edge function `generate-share-card` using HTML → PNG (or canvas in-browser)
- Output: 1200×630 PNG with grade letter, parlay summary, ParlayFarm branding
- Auto-downloads + provides "Tweet this" / "Share to IG" buttons
- Each share card has a unique ID and tracks opens/clicks (free distribution)

### 4. Email capture + database
- New table: `email_subscribers`
  - `email`, `source` ('grade'|'leaderboard'|'organic'), `signed_up_at`
  - `drip_day` (0–7, tracks where they are in sequence), `drip_paused`
  - `converted_to_paid` boolean, `unsubscribed_at`
- RLS: service-role writes; public reads disabled
- Modal/inline form on `/grade` after partial grade preview

### 5. Email infrastructure setup
- Set up email domain (`notify.parlayfarm.com` or similar)
- Configure Lovable Emails infrastructure for app emails
- Create transactional templates:
  - **Welcome + first grade breakdown** — sent immediately after email capture
  - **Daily pick drop** — Day 1–7 picks with reasoning + bot voice
  - **Day 7 upgrade CTA** — "Here's what you've been missing on Telegram"

### 6. Daily pick drip cron
- New edge function `send-daily-pick-drip`
- Runs daily at 11 AM ET via pg_cron
- For each subscriber where `drip_day < 7`:
  - Pull today's top free pick from `bot_daily_picks` (highest confidence single)
  - Render with bot voice/humor + accuracy phrase
  - Send via `send-transactional-email`
  - Increment `drip_day`
- Day 7 send includes upgrade CTA + 7-day P&L recap

### 7. Tracking + admin view
- New table: `grade_events` — every slip graded (no PII), tracks share card opens
- Add a tile on existing admin dashboard showing: grades today, emails captured, drip conversions, paid upgrades attributed to grade funnel

## Files touched

**Create:**
- `src/pages/GradeSlip.tsx` (new `/grade` route)
- `src/components/grade/GradeReveal.tsx` (animated A/B/C/F card)
- `src/components/grade/EmailGate.tsx` (capture form)
- `src/components/grade/ShareCard.tsx` (preview + download)
- `supabase/functions/grade-slip/index.ts`
- `supabase/functions/generate-share-card/index.ts`
- `supabase/functions/send-daily-pick-drip/index.ts`
- 3 new email templates in `_shared/transactional-email-templates/`

**Modify:**
- `src/App.tsx` — add `/grade` route
- `src/pages/Index.tsx` — add a small "Grade my slip free →" link near the analyzer

**DB:**
- New tables `email_subscribers`, `grade_events` (RLS, service-role writes)
- pg_cron job for daily drip (11 AM ET)

**Email:**
- Email domain setup (need user to confirm subdomain — `notify.parlayfarm.com`)
- Lovable Emails infrastructure
- 3 transactional templates

## Out of scope (future loops)
- A/B testing different grade copy
- Multi-day automated nurture beyond day 7
- Refer-a-friend on the share card
- SMS drip (email only this round)

## Risk + rollback
- **Risk**: emails getting marked spam early → reputation damage. Mitigation: warm up slowly (cap drip sends at 100/day for first week), proper domain setup with SPF/DKIM (handled by Lovable Emails).
- **Risk**: grading copy too harsh → drives people away. Mitigation: brutal headline + constructive breakdown ("Here's how to fix it: ___").
- **Rollback**: feature-flag the `/grade` route + cron job. Disable both → funnel goes dark, no other system affected.

## Testing (project policy: 5 verifications)
1. Paste a junk slip → verify F grade + funny one-liner
2. Paste a strong slip → verify A/B grade
3. Submit email → verify subscriber row created + welcome email sent
4. Force daily drip cron → verify 1 pick email sent per active subscriber, drip_day increments
5. Day 7 subscriber → verify upgrade CTA email fires
6. Click unsubscribe → verify suppression + no further sends

## What does NOT change
- Bot pipeline (generators, orchestrator, Telegram fanout) — zero touch
- Existing `/upload` flow stays as the deeper paid-feature analyzer
- Pricing, auth, blog, hedge tracker — zero touch

