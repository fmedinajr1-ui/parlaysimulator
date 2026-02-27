
## Deploy and Fix fetch-team-defense-ratings

### Problem Identified
The function was successfully deployed and invoked, but it **hangs indefinitely** on NBA.com API calls. The logs show it started fetching all 3 endpoints (Opponent, Base, Advanced) but never progressed further -- NBA.com is either blocking or not responding to requests from edge function IPs.

The current code has retry logic (3 attempts per endpoint) but **no per-request timeout**, so if NBA.com silently drops the connection, the function waits until the edge function's global 60s timeout kills it -- never reaching the fallback path.

### Fix: Add Fetch Timeouts + Immediate Fallback

**File**: `supabase/functions/fetch-team-defense-ratings/index.ts`

1. **Add AbortController timeout** to each `fetch()` call in `fetchNBAStats()` (8-second timeout per attempt)
   - This ensures each NBA.com request either succeeds quickly or fails fast
   - After 3 failed attempts, returns `null` which triggers the hardcoded fallback

2. **Reduce retry delays** from 2s/4s/6s to 1s/2s so total worst-case is ~30s instead of hanging

### Code Changes

In `fetchNBAStats()` (~line 107-163), wrap the fetch with an AbortController:

```typescript
// Before the fetch call, add timeout:
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout

const resp = await fetch(url, { 
  headers: NBA_STATS_HEADERS, 
  signal: controller.signal 
});
clearTimeout(timeoutId);
```

And reduce retry delay:
```typescript
if (attempt < 3) { await new Promise(r => setTimeout(r, 1000 * attempt)); continue; }
```

### After Fix
- Redeploy the function
- Invoke it again -- it should either pull live data (if NBA.com responds within 8s) or fall back to hardcoded data within ~30s
- Verify `team_defense_rankings` gets updated with offensive columns populated
- The cron job will also work correctly going forward since the function won't hang

### Expected Outcome
- `off_points_rank`, `off_rebounds_rank`, `off_assists_rank`, `off_threes_rank`, `off_pace_rank` all populated
- `updated_at` set to today's date
- All downstream engines (`prop-engine-v2`, `bot-review-and-optimize`, `bot-generate-daily-parlays`) will have fresh data
