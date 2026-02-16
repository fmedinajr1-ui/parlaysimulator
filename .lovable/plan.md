
# Admin Analytics Dashboard

## Overview
Add a new "Site Analytics" section to the existing Admin panel that displays visitor stats, page views over time, subscription click counts, and conversion rates -- all powered by the `analytics_events` table already in place.

## What You'll See
- **Summary cards**: Total visitors (unique fingerprints), total page views, subscription clicks, and conversion rate
- **Page views over time chart**: A line/area chart showing daily page views for the last 30 days
- **Top pages table**: Which pages get the most traffic
- **Subscription funnel**: Visual breakdown of page views vs. subscribe clicks vs. conversions
- **Recent activity feed**: Latest events in real-time

## Technical Details

### 1. Create `src/components/admin/SiteAnalyticsDashboard.tsx`
A new admin component that:
- Queries `analytics_events` table with aggregations (grouped by date, event type, page path)
- Uses `recharts` (already installed) for charts via the existing `ChartContainer` components
- Uses the existing `StatsCard`/`StatItem` components for summary metrics
- Computes:
  - **Unique visitors**: COUNT DISTINCT `device_fingerprint`
  - **Total page views**: COUNT WHERE `event_type = 'page_view'`
  - **Subscribe clicks**: COUNT WHERE `event_type = 'subscribe_click'`
  - **Conversion rate**: subscribe clicks / unique visitors
- Time range filter (7d / 30d / 90d)

### 2. Add section to Admin panel (`src/pages/Admin.tsx`)
- Add `'analytics'` to the `AdminSection` type
- Add a new card in `sectionConfig` (icon: `BarChart3` or `Activity`)
- Add case in `renderSectionContent` to render `<SiteAnalyticsDashboard />`

### 3. Data fetching approach
- Use multiple Supabase queries from the client side (admin-only via RLS)
- Group page views by date using JS (since Supabase JS client doesn't support GROUP BY directly)
- Fetch last 30/90 days of events and aggregate in the component

### Files Changed
- `src/components/admin/SiteAnalyticsDashboard.tsx` -- NEW
- `src/pages/Admin.tsx` -- add analytics section entry
