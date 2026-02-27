

## Add AbortController Timeouts to All External-API Edge Functions

### Problem
Only `fetch-team-defense-ratings` has `AbortController` timeouts. All other edge functions calling external APIs (Odds API, ESPN, PrizePicks, OpenAI, NBA.com, Resend, Firecrawl) can hang indefinitely if the remote server doesn't respond, consuming the full 60s edge function limit before dying -- never reaching error handling or fallback logic.

### Scope
15 high-risk functions that make external API calls without any timeout protection. Internal calls to other edge functions (via `supabase/functions/v1/...`) are lower risk since they have their own timeout, so we'll focus on external APIs only.

### Functions to Fix (grouped by external API)

**Odds API (the-odds-api.com) -- 7 functions:**
1. `whale-odds-scraper` -- Multiple fetch calls per sport in loops (highest volume)
2. `nba-mega-parlay-scanner` -- Parallel fetches per event
3. `fetch-current-odds` -- Single fetch per invocation
4. `fetch-batch-odds` -- Batch fetch
5. `fetch-alternate-lines` -- Single fetch
6. `track-odds-movement` -- Multiple fetch calls in loops
7. `track-juiced-prop-movement` -- Multiple fetch calls in loops

**ESPN API -- 5 functions:**
8. `firecrawl-lineup-scraper` -- 3 ESPN calls + 1 Firecrawl call
9. `nba-team-pace-fetcher` -- Team record fetches
10. `bot-settle-and-learn` -- ESPN scoreboard + Odds API calls
11. `fetch-season-standings` -- ESPN standings fetch
12. `fetch-game-scores` -- ESPN/Odds API scores

**PrizePicks API -- 1 function:**
13. `pp-props-scraper` -- Retry loop with no per-request timeout

**OpenAI API -- 2 highest-risk functions:**
14. `analyze-live-frame` -- Vision API calls (large payloads, slow responses)
15. `extract-parlay` -- Multiple OpenAI calls per invocation

Note: Several other functions call OpenAI (`generate-roasts`, `betting-calendar-insights`, `fetch-player-context`, `analyze-game-footage`, `compile-halftime-analysis`, `scout-agent-loop`, `fetch-injury-updates`) but those are user-triggered or lower frequency. We'll add timeouts to those too for completeness.

### Implementation Pattern

Add a shared helper pattern at the top of each function:

```typescript
async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 10000): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    return resp;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

**Timeout values by API type:**
- Odds API: **10s** (usually fast, but can stall)
- ESPN API: **8s** (generally reliable)
- PrizePicks API: **10s** (often slow/blocked)
- OpenAI API: **30s** (vision models are genuinely slow)
- Firecrawl: **15s** (web scraping is variable)

### Changes Per Function

For each function, we will:
1. Add the `fetchWithTimeout` helper at the top
2. Replace all `await fetch(url, ...)` calls to external APIs with `await fetchWithTimeout(url, ..., timeout)`
3. Leave internal Supabase edge function calls (`/functions/v1/...`) unchanged
4. Ensure existing catch blocks handle `AbortError` gracefully with clear logging

### Functions with existing `fetchWithRetry` (3 functions)
- `unified-player-feed`, `ncaa-baseball-team-stats-fetcher`, `ncaab-team-stats-fetcher` already have retry wrappers but **no timeout**. We'll add AbortController inside their existing retry loops.

### Execution Order
We'll batch the changes by API type to maintain consistency, updating ~5 files in parallel per batch.

