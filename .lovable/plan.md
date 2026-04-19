

## Free Slip Grader 2.0 — Build Plan (final scope)

What's already done from the earlier phase:
- `email_subscribers` + `grade_events` tables exist with drip columns
- Email infra deployed on `notify.parlayfarm.com`
- 3 templates created: `grade-welcome`, `daily-pick-drop`, `day-7-upgrade`
- `extract-parlay` edge function exists (reuse for slip parsing)
- `bot_daily_picks` schema confirmed — has confidence, edge_pct, reasoning, status

What's left to ship the funnel end-to-end:

### 1. `/grade` landing page (`src/pages/GradeSlip.tsx`)
- Hero: **"Paste your slip. We'll tell you why it'll lose."**
- Three input modes (reuse HomepageAnalyzer patterns): paste text, upload screenshot, manual entry
- Calls `extract-parlay` for screenshots, then `grade-slip` for the verdict
- Shows letter grade + 1-line headline immediately (preview)
- Email gate appears between preview and full breakdown
- After email submit → full per-leg breakdown + share card download
- Components broken out: `GradeReveal.tsx`, `EmailGate.tsx`, `ShareCard.tsx`

### 2. `grade-slip` edge function
- Input: parsed legs array
- Returns `{ letter_grade, headline, composite_score, breakdown[], share_card_id }`
- Rubric: weighted blend of avg implied probability, leg count penalty, correlation flags, bot voice
- A: composite ≥ 75 · B: 60–74 · C: 45–59 · D: 30–44 · F: <30
- Headlines pulled from a tiered pool ("This is a coin flip wearing a tuxedo." etc.)
- Logs anonymous row to `grade_events`
- `verify_jwt = false` (public endpoint)

### 3. Share card via in-browser canvas (no extra edge function)
- Reuse `ShareableImageCard` styling, render off-screen with `html2canvas` (or build SVG → PNG)
- "Copy image" / "Download PNG" / "Tweet this" / "Share to IG" buttons
- Card includes the grade letter, parlay summary, headline, parlayfarm.com URL
- Each card carries the `share_card_id` so we can attribute returning traffic later

### 4. Email capture
- Inline form on `/grade` after grade preview
- Insert into `email_subscribers` with `source='grade'`, `drip_day=0`
- Immediately invoke `send-transactional-email` with `grade-welcome` template (full breakdown in the email)
- Idempotency key: `grade-welcome-${subscriber_id}`

### 5. `send-daily-pick-drip` edge function + cron
- Runs daily at 11 AM ET
- For every subscriber where `drip_day < 7 AND drip_paused = false AND unsubscribed_at IS NULL`:
  - Pull top free pick from `bot_daily_picks` (highest confidence singles for today)
  - Send `daily-pick-drop` template with pick + bot voice reasoning
  - On day 7, send `day-7-upgrade` instead
  - Increment `drip_day`, set `last_drip_sent_at`
- pg_cron job with the project anon key (use insert tool — contains user-specific URL)
- Daily send cap: 100/day for first week (warm-up flag in env)

### 6. Homepage hook
- Add small "Grade my slip free →" CTA near `HomepageAnalyzer` on Index.tsx
- Add `/grade` route to `App.tsx` (lazy-loaded)

### 7. Admin tile (small)
- One new tile on the existing admin dashboard: grades today, emails captured, drip sends, paid conversions attributed to grade funnel
- Pure read query against `grade_events` + `email_subscribers`

## Files

**Create:**
- `src/pages/GradeSlip.tsx`
- `src/components/grade/GradeReveal.tsx`
- `src/components/grade/EmailGate.tsx`
- `src/components/grade/ShareCard.tsx`
- `supabase/functions/grade-slip/index.ts` (+ `deno.json`)
- `supabase/functions/send-daily-pick-drip/index.ts` (+ `deno.json`)

**Modify:**
- `src/App.tsx` (route + lazy import)
- `src/pages/Index.tsx` (CTA link)
- `src/components/admin/*` (one tile)

**DB ops (insert tool, not migration — user-specific data):**
- pg_cron schedule for `send-daily-pick-drip` at 11 AM ET

## Out of scope (future)
- A/B test grade copy
- Refer-a-friend on share card
- SMS drip
- Multi-day nurture beyond day 7

## Risk + rollback
- **Risk**: spam reputation. Mitigation: 100/day cap warm-up, suppression already wired, Lovable Emails handles SPF/DKIM
- **Risk**: harsh copy churns users. Mitigation: brutal headline + constructive per-leg fix in breakdown
- **Rollback**: remove `/grade` route + disable cron job → funnel goes dark, zero impact on bot pipeline

## Testing (5 verifications)
1. Paste a junk 5-leg slip → F grade + funny headline shown
2. Submit email after grade preview → subscriber row created + welcome email queued
3. Force `send-daily-pick-drip` → one pick email sent per active sub, drip_day increments
4. Subscriber at drip_day=6 → day 7 upgrade CTA email fires
5. Click unsubscribe link → suppression works, no further sends

