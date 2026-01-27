

# Add Manual PP Scraper Button & Whale Proxy Cron Jobs

## Overview

Implement two features to keep the Whale Proxy pipeline fresh:
1. **"Scrape PP Now" button** - Manual trigger on the dashboard to run the full scrape + detect pipeline
2. **Cron jobs** - Automated 5-minute runs of pp-props-scraper and whale-signal-detector

---

## Part 1: Add "Scrape PP Now" Button

### Update `src/hooks/useWhaleProxy.ts`

Add a new function `triggerFullScrape` that:
1. Invokes `pp-props-scraper` with all sports (NBA, NHL, WNBA, ATP, WTA)
2. Waits for completion
3. Invokes `whale-signal-detector` to analyze the fresh data
4. Refreshes the UI picks
5. Shows success/error toast with scraped prop count

```typescript
const [isScraping, setIsScraping] = useState(false);

const triggerFullScrape = useCallback(async () => {
  if (isSimulating || isScraping) return;
  
  try {
    setIsScraping(true);
    
    // Step 1: Scrape PrizePicks props
    const { data: scrapeData, error: scrapeError } = await supabase.functions.invoke('pp-props-scraper', {
      body: { sports: ['NBA', 'NHL', 'WNBA', 'ATP', 'WTA'] }
    });
    
    if (scrapeError) {
      toast.error('Failed to scrape PP props');
      return;
    }
    
    // Step 2: Run whale detector
    const { data: detectData, error: detectError } = await supabase.functions.invoke('whale-signal-detector', {
      body: { sports: ['basketball_nba', 'hockey_nhl', 'basketball_wnba', 'tennis_atp', 'tennis_wta'] }
    });
    
    if (detectError) {
      toast.error('Scraped props but signal detection failed');
      return;
    }
    
    // Step 3: Refresh picks
    await fetchRealPicks();
    
    toast.success(`Scraped ${scrapeData?.propsScraped || 0} props → ${detectData?.signalsGenerated || 0} signals`);
  } catch (err) {
    toast.error('Scrape failed');
  } finally {
    setIsScraping(false);
  }
}, [isSimulating, isScraping, fetchRealPicks]);
```

Return `isScraping` and `triggerFullScrape` from the hook.

### Update `src/components/whale/WhaleProxyDashboard.tsx`

Add a "Scrape PP" button next to the refresh button:

```tsx
import { Download, RefreshCw } from "lucide-react";

const { isScraping, triggerFullScrape, isRefreshing, triggerRefresh } = useWhaleProxy();

// In the header actions area:
<Button
  variant="outline"
  size="sm"
  onClick={triggerFullScrape}
  disabled={isScraping || isRefreshing || isSimulating}
  className="gap-1.5 text-xs"
>
  <Download className={cn("w-3.5 h-3.5", isScraping && "animate-pulse")} />
  {isScraping ? "Scraping..." : "Scrape PP"}
</Button>
```

---

## Part 2: Add Cron Jobs (Every 5 Minutes)

Create two new cron jobs that run every 5 minutes to keep the whale proxy data fresh:

### Cron Job 1: PP Props Scraper

```sql
SELECT cron.schedule(
  'whale-pp-scraper-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/pp-props-scraper',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhamFrYXFwaGx4b3FqdHJ4em1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjIzNDcsImV4cCI6MjA3OTgzODM0N30.xeQu6cDtWz8GjVaG1EhMqNZUhYkn1Yq6L9z4dop03co"}'::jsonb,
    body := '{"sports": ["NBA", "NHL", "WNBA", "ATP", "WTA"]}'::jsonb
  ) AS request_id;
  $$
);
```

### Cron Job 2: Whale Signal Detector

```sql
SELECT cron.schedule(
  'whale-signal-detector-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://pajakaqphlxoqjtrxzmi.supabase.co/functions/v1/whale-signal-detector',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhamFrYXFwaGx4b3FqdHJ4em1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjIzNDcsImV4cCI6MjA3OTgzODM0N30.xeQu6cDtWz8GjVaG1EhMqNZUhYkn1Yq6L9z4dop03co"}'::jsonb,
    body := '{"sports": ["basketball_nba", "hockey_nhl", "basketball_wnba", "tennis_atp", "tennis_wta"]}'::jsonb
  ) AS request_id;
  $$
);
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/hooks/useWhaleProxy.ts` | Add `isScraping` state and `triggerFullScrape` function |
| `src/components/whale/WhaleProxyDashboard.tsx` | Add "Scrape PP" button in header |
| *(SQL via migration tool)* | Create two cron jobs for 5-minute automated runs |

---

## Expected Behavior

### Manual Button
1. User clicks "Scrape PP" button
2. Button shows "Scraping..." with pulse animation
3. Edge function scrapes all PrizePicks props (NBA, NHL, WNBA, ATP, WTA)
4. Whale detector analyzes for signals
5. Toast shows: "Scraped 47 props → 3 signals"
6. Dashboard updates with new signals

### Automated Cron
1. Every 5 minutes, `pp-props-scraper` runs and captures fresh PrizePicks lines
2. Immediately after, `whale-signal-detector` runs and analyzes for divergences
3. Real-time subscription updates the dashboard automatically when new signals are inserted

---

## UI Preview

```text
┌──────────────────────────────────────────────────────────┐
│  🔱 PP Whale Proxy                    Last: 2s ago [↻] │
│     Sharp signal detector • No NFL    [📥 Scrape PP]    │
├──────────────────────────────────────────────────────────┤
│  ...                                                     │
└──────────────────────────────────────────────────────────┘
```

