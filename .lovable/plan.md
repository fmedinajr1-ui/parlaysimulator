
# Granular Analytics for the Parlay Bot Landing Page

## Overview
Add detailed tracking to the Bot Landing page (`/`) so you can see exactly how visitors interact with it: which sections they scroll to, which CTAs they click, and how long they spend on the page. All data flows into the existing `analytics_events` table and shows up in your admin dashboard.

## What Gets Tracked

### 1. CTA Button Clicks
- **"Join Now" button** on the PricingCard -- fires `cta_click` with label `join_now`
- **Telegram link click** (success banner) -- fires `cta_click` with label `telegram_link`
- **Scroll-to-pricing** (if user scrolls into the pricing section) -- fires `section_view` with label `pricing`

### 2. Section Scroll Visibility
Using the Intersection Observer API, track when a visitor scrolls each section into view:
- `hero_stats` -- the top stats area
- `performance_calendar` -- the calendar grid
- `why_multiple_parlays` -- the explainer section
- `pricing` -- the pricing card

Each fires a `section_view` event (once per session per section) so you can see how far down the page visitors scroll.

### 3. Time Spent on Page
A `useTimeOnPage` hook records how long a visitor stays on the landing page. When they navigate away or close the tab, it fires a `time_on_page` event with `duration_seconds` in metadata. Tab visibility changes pause/resume the timer.

### 4. Updated Admin Dashboard
Add new cards and a breakdown table to the existing Site Analytics dashboard:
- **CTA Clicks** summary card
- **Avg. Time on Page** card
- **Section Reach** table showing what percentage of visitors saw each section
- **CTA Click Breakdown** table showing counts per label (join_now, telegram_link)

## Technical Details

### Files Created
- None -- all new code goes into existing files

### Files Modified

**`src/hooks/useAnalytics.ts`**
- Export `trackEvent` so it can be called directly from components
- Add `useTimeOnPage()` hook: records start time, listens to `visibilitychange`, fires `time_on_page` on unmount/navigation
- Add `useSectionView(sectionId)` hook: uses `IntersectionObserver` to fire a one-time `section_view` event when a section scrolls into view

**`src/pages/BotLanding.tsx`**
- Import and call `useTimeOnPage()` for page-level duration tracking
- Wrap each section with a ref and pass to `useSectionView` for scroll tracking
- Track the "Join Now" CTA click before calling `handleCheckout`
- Track Telegram link clicks in the success banner

**`src/components/bot-landing/PricingCard.tsx`**
- Accept an optional `onCtaClick` callback prop
- Call it when "Join Now" is clicked (before `onSubscribe`)

**`src/components/admin/SiteAnalyticsDashboard.tsx`**
- Add CTA Clicks and Avg. Time on Page stat cards
- Add a CTA breakdown table (group `cta_click` events by `metadata.label`)
- Add a Section Reach table (group `section_view` events by `metadata.section`)

### No database changes needed
All new event types (`cta_click`, `section_view`, `time_on_page`) use the existing `analytics_events` table with the `metadata` JSONB column.
