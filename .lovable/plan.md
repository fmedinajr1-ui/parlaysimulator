

## L3 Verification Report & Plan

### Current State (March 10)

**L3 Gate code: Working correctly.** The NULL-blocking fix is deployed and active. Here's what the data looks like:

| Metric | Value |
|--------|-------|
| Total active sweet spots today | 405 |
| With valid `l3_avg` | 3 (0.7%) |
| Missing `l3_avg` (blocked by gate) | 402 |

**Why so few?** 402 of 405 today's sweet spots are **NHL records** inserted by the `nhl-floor-lock` pipeline at 16:02 UTC. That pipeline writes directly to `category_sweet_spots` without computing `l3_avg`. Only 3 NBA AVG_RANGE spots were found by the category analyzer today.

**L3 parlay candidates that clear their line (OVER):**

```text
Player             | Prop    | Line  | L3 Avg | L3 Score | Status
Ty Jerome          | Points  | 16.5  | 19.7   | +3.2     | ✅ Clears
Brandon Williams   | Points  | 12.5  | 15.0   | +2.5     | ✅ Clears
Jalen Duren        | Points  | 17.5  | 16.0   | -1.5     | ❌ Below line
```

**Result: Only 2 candidates clear the line. Need 5 for an L3 parlay. That's why no `sweet_spot_l3` parlay was generated today.**

### Root Causes

1. **NHL pipeline doesn't compute `l3_avg`** — 402 NHL sweet spots inserted without recency data
2. **Category analyzer found only 3 NBA sweet spots today** — thin slate means thin L3 pool
3. **No mechanism to backfill `l3_avg` on NHL-inserted records**

### Plan

#### 1. Fix NHL pipeline to compute `l3_avg`
Update the NHL floor-lock pipeline's sweet spot insertion to compute L3 averages from `nhl_skater_game_logs` before writing to `category_sweet_spots`. This will populate `l3_avg` for all 402 NHL records.

#### 2. Re-run category analyzer with fresh data
Invoke `category-props-analyzer` with `forceRefresh: true` to re-scan NBA and populate more sweet spots with `l3_avg`. If more than 5 candidates clear their lines, an L3 parlay becomes viable.

#### 3. Trigger L3 parlay generation
After data refresh, invoke `bot-generate-daily-parlays` to build the `sweet_spot_l3` 5-leg parlay from the refreshed pool.

#### 4. Broadcast L3 parlay via Telegram
Once generated, send the L3 parlay to customers using the existing broadcast mechanism.

### Technical Details

**File to edit:** `supabase/functions/nhl-floor-lock-daily/index.ts` (or whichever NHL function inserts into `category_sweet_spots`) — add L3 computation block before upsert, mirroring the NBA analyzer's logic at line 1371-1373.

**Edge functions to invoke sequentially:**
1. `category-props-analyzer` (forceRefresh)
2. `bot-generate-daily-parlays` (to build L3 parlay)
3. `bot-send-telegram` (broadcast result)

