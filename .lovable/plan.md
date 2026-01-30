

# Fix ESPN Game Log Date Parsing Issue

## Problem Identified

The `nba-stats-fetcher` edge function has a **date assignment bug** causing outcome verification to fail:

| ESPN Shows | Actual Game Date (ET) | Our Database |
|------------|----------------------|--------------|
| Thu 1/29 vs OKC | Jan 29th ET evening | **Missing** (not yet fetched) |
| Wed 1/28 vs DAL | Jan 28th ET evening | Stored as Jan 29 ❌ |

**Root Cause:** ESPN's API returns dates based on UTC midnight, not Eastern Time. Games that play at 7pm-10pm ET on January 29th are recorded by ESPN as January 30th (since they cross UTC midnight). Our fetcher then uses ESPN's reported date directly, causing a 1-day offset.

---

## Current Data Source

The system uses **ESPN's NBA API** as the primary source (`nba-stats-fetcher/index.ts`):

```text
ESPN_NBA_API = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
```

With `balldontlie.io` as a secondary/backup source.

---

## Verification Impact

When `verify-sweet-spot-outcomes` runs for `analysis_date = '2026-01-29'`:
1. It looks for game logs where `game_date = '2026-01-29'`
2. Finds Edwards with 3 3PM (but this was actually Jan 28th's game)
3. Grades picks incorrectly because it's using the wrong game data

---

## Solution

### Option A: Fix at Fetch Time (Recommended)

Modify the ESPN parser in `nba-stats-fetcher` to convert ESPN's UTC dates to Eastern Time:

```typescript
// When parsing ESPN boxscore dates
const espnDate = boxData.header?.competitions?.[0]?.date; // "2026-01-30T00:10:00Z"
const easternDate = new Date(espnDate).toLocaleDateString('en-US', { 
  timeZone: 'America/New_York' 
});
// Result: "1/29/2026" - correctly stored as 2026-01-29
```

### Files to Modify

| File | Change |
|------|--------|
| `supabase/functions/nba-stats-fetcher/index.ts` | Add UTC→ET date conversion when parsing ESPN game dates |
| `supabase/functions/verify-sweet-spot-outcomes/index.ts` | No changes needed if fetch is fixed |

---

## Implementation Steps

### Step 1: Update ESPN Date Parsing

In the `fetchESPNGameLogs` function, convert the game date from UTC to Eastern Time:

```typescript
// Before (wrong):
const gameDate = boxData.header?.competitions?.[0]?.date?.split('T')[0] || game.dateStr;

// After (correct):
const rawDate = boxData.header?.competitions?.[0]?.date;
const gameDate = rawDate 
  ? new Date(rawDate).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) 
  : game.dateStr;
// 'en-CA' locale gives YYYY-MM-DD format
```

### Step 2: Re-sync Game Logs

After deploying the fix, trigger a full re-sync to correct historical data:

```bash
# Call the edge function with extended lookback
POST /nba-stats-fetcher
{ "daysBack": 14, "useESPN": true }
```

### Step 3: Re-run Verification

Once game logs are corrected, re-run outcome verification for affected dates:

```bash
POST /verify-sweet-spot-outcomes
{ "date": "2026-01-29" }
```

---

## Expected Results After Fix

For January 29th ET:
- **Anthony Edwards:** 4 3PM vs OKC → O 3.5 **HIT**
- **Kevin Durant:** 3 3PM vs ATL → O 2.5 **HIT**

This will restore accurate outcome tracking and system performance metrics.

---

## Technical Details

### ESPN API Date Behavior

ESPN's scoreboard API (`/scoreboard?dates=YYYYMMDD`) uses local display dates, but the boxscore `competition.date` field uses full UTC timestamps:

```json
{
  "date": "2026-01-30T00:10:00Z",  // 7:10 PM ET on Jan 29th
  "venue": { "fullName": "Target Center" }
}
```

Our current parser strips the time component (`split('T')[0]`), leaving `2026-01-30` when it should be `2026-01-29` in Eastern Time.

### Why This Matters

All NBA games are scheduled around Eastern Time:
- 7:00 PM ET = 00:00 UTC next day
- 10:30 PM ET = 03:30 UTC next day

So virtually ALL evening games will have incorrect dates without the timezone conversion.

