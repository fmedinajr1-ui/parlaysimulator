

# Fix Whale Proxy to Show Tennis Signals

## Problem Summary

The Whale Proxy dashboard shows "No Sharp Signals Detected" for two reasons:

1. **All existing picks have expired** - 8 NBA picks existed but expired at 2:35 AM UTC (current time is 4:24 AM UTC)
2. **Tennis data is never scraped** - The pipeline excludes ATP/WTA sports from scraping and detection

## Root Cause Analysis

| Component | Issue |
|-----------|-------|
| `pp-props-scraper` | Defaults to `['NBA', 'NHL', 'WNBA']` - excludes `ATP`, `WTA` |
| `whale-signal-detector` | Defaults to `['basketball_nba', 'hockey_nhl', 'basketball_wnba']` - no tennis |
| `data-pipeline-orchestrator` | Only triggers scrapes for NBA/NHL/WNBA |
| `unified_props` table | Empty - no sportsbook odds data to compare against |
| Current whale_picks | All 8 picks expired 2 hours ago |

## Solution

### Step 1: Add Tennis to Default Sports in PP Scraper

**File:** `supabase/functions/pp-props-scraper/index.ts`

```typescript
// Line 186: Change default sports array
const { sports = ['NBA', 'NHL', 'WNBA', 'ATP', 'WTA'] } = await req.json().catch(() => ({}));
```

### Step 2: Add Tennis to Whale Signal Detector

**File:** `supabase/functions/whale-signal-detector/index.ts`

```typescript
// Line 96: Add tennis sport keys
const { sports = ['basketball_nba', 'hockey_nhl', 'basketball_wnba', 'tennis_atp', 'tennis_wta'] } = await req.json().catch(() => ({}));
```

### Step 3: Add Tennis to Data Pipeline Orchestrator

**File:** `supabase/functions/data-pipeline-orchestrator/index.ts`

```typescript
// Line 77: Add ATP and WTA to PP scraper call
await runFunction('pp-props-scraper', { sports: ['NBA', 'NHL', 'WNBA', 'ATP', 'WTA'] });
```

### Step 4: Add Manual Scraper Trigger Button (Optional)

Add a button to the Whale Proxy dashboard that triggers `pp-props-scraper` on demand, so you can force-populate the pipeline when no data exists.

**File:** `src/components/whale/WhaleProxyDashboard.tsx`

Add alongside the refresh button:
- "Scrape PP" button that invokes `pp-props-scraper` with all supported sports
- Shows loading state while scraping
- Displays success/error toast with count of props scraped

---

## Technical Details

### Sport Key Mappings

The system uses different sport keys at different layers:

| UI Display | PP Scraper Input | Database Key | Whale Detector |
|------------|------------------|--------------|----------------|
| Tennis | `ATP` / `WTA` | `tennis_atp` / `tennis_wta` | `tennis_atp` / `tennis_wta` |
| NBA | `NBA` | `basketball_nba` | `basketball_nba` |
| NHL | `NHL` | `hockey_nhl` | `hockey_nhl` |
| WNBA | `WNBA` | `basketball_wnba` | `basketball_wnba` |

### Why Signals Don't Appear (Even After Fixing Tennis)

The whale detector needs BOTH data sources to generate signals:

1. **PP Snapshot** - PrizePicks lines (from `pp-props-scraper`)
2. **Unified Props** - Sportsbook lines (from odds API)

Currently `unified_props` is empty, so even the book-to-book divergence fallback fails. The odds API scraper (`refresh-todays-props` or similar) needs to be running and populating data.

---

## Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/pp-props-scraper/index.ts` | Add `'ATP', 'WTA'` to default sports |
| `supabase/functions/whale-signal-detector/index.ts` | Add `'tennis_atp', 'tennis_wta'` to default sports |
| `supabase/functions/data-pipeline-orchestrator/index.ts` | Add ATP/WTA to PP scraper trigger |
| `src/components/whale/WhaleProxyDashboard.tsx` | (Optional) Add manual scraper trigger button |

---

## Expected Result

After implementation:
1. Tennis props will be scraped from PrizePicks along with other sports
2. The whale detector will analyze tennis lines for divergence signals
3. Tennis signals will appear in the dashboard when market movement is detected
4. Users can manually trigger a scrape if no data exists

