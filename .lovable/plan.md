
# Fix Whale Proxy Data Pipeline - Show Signals

## Problem

The Whale Proxy dashboard shows no signals because:
1. All existing `whale_picks` have expired (games already started)
2. `unified_props` table is empty - no sportsbook data
3. `pp_snapshot` only has placeholder test data
4. The `whale-signal-detector` has no fresh data to analyze

## Root Cause

The data pipeline that feeds the Whale Proxy is not running:
- The `pp-props-scraper` edge function needs to populate `pp_snapshot`
- The odds API needs to populate `unified_props`
- Without either data source, the detector returns "No fresh PP data or book divergence found"

---

## Solution Options

### Option A: Fix the Data Scrapers (Recommended)

Ensure the data pipeline functions are running on a schedule:

1. **Verify `pp-props-scraper` is deployed and scheduled**
   - Check if a cron job triggers it every 2-5 minutes
   - Ensure Firecrawl API key is configured

2. **Verify odds data is being fetched**
   - Check if `fetch-player-props` or similar function populates `unified_props`
   - Ensure the Odds API key is configured

3. **Add logging to diagnose pipeline issues**

### Option B: Add Graceful Empty State (Quick Fix)

Update the UI to show a better empty state that explains WHY there are no signals:

**File:** `src/components/whale/WhaleProxyDashboard.tsx`

When no picks are available, show:
- "No active signals" message
- Reason: "Waiting for upcoming games with detectable line movement"
- Data freshness indicators showing when scrapers last ran

### Option C: Add Manual PP Scraper Trigger (For Testing)

Add a button to manually trigger the `pp-props-scraper` alongside the existing refresh button, so you can force-populate the data pipeline.

---

## Recommended Implementation

### Phase 1: Better Empty State UI

**File:** `src/components/whale/WhaleProxyDashboard.tsx`

Add an informative empty state when no signals exist:

```text
No Sharp Signals Detected

The detector is monitoring for:
- PrizePicks vs book line divergences
- Rapid line movements (steam moves)
- Book-to-book disagreements

Signals appear when games are approaching tip-off (1-4 hours out)
and market movement is detected.

Last scan: [timestamp] | Next scan in: [countdown]
```

### Phase 2: Check Data Pipeline Status

**File:** `src/hooks/useWhaleProxy.ts`

Add a function to check when scrapers last ran:

```typescript
const checkDataHealth = async () => {
  // Check pp_snapshot for last capture
  const { data: ppData } = await supabase
    .from('pp_snapshot')
    .select('captured_at')
    .order('captured_at', { ascending: false })
    .limit(1);
    
  // Check unified_props for last update  
  const { data: propsData } = await supabase
    .from('unified_props')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(1);
    
  return {
    lastPpScrape: ppData?.[0]?.captured_at,
    lastPropsFetch: propsData?.[0]?.created_at,
    hasFreshData: /* check if within last 30 min */
  };
};
```

### Phase 3: Trigger Scraper Button (Optional)

Add ability to trigger `pp-props-scraper` from the UI to manually populate data.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/whale/WhaleProxyDashboard.tsx` | Add informative empty state with reasons why no signals exist |
| `src/hooks/useWhaleProxy.ts` | Add `dataHealth` state to track when scrapers last ran |
| `src/components/whale/WhaleFeedHealth.tsx` | Show scraper status (last PP scrape, last props fetch) |

---

## Expected Result

When no signals are available, users will see:
1. A clear explanation that the system is working but no signals are detected
2. Information about what conditions trigger signals
3. Data freshness indicators showing if the scrapers are running
4. This removes confusion about whether the feature is "broken" vs "no signals right now"
