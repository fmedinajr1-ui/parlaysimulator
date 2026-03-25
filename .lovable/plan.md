

# Fix Whale Odds Scraper — 422 Errors on Player Props

## What's Happening

Your API key is working again (no more 401). However, **every player props request now returns HTTP 422** (Unprocessable Entity). The scraper currently discards the error body, so we can't see the exact reason. There are two likely causes:

1. **Your new subscription tier may not include player props** — props require a paid plan on The Odds API
2. **Invalid market keys in batches** — the scraper includes `player_threes_q1` and `player_steals_q1` which are NOT valid API markets; if any market in a batch is invalid, the entire batch fails

## Plan

### Step 1: Log the 422 response body for diagnosis

Update the error handler in the scraper to read and log the response body on 422 errors. This will tell us exactly whether it's "INVALID_MARKET" or "subscription tier required."

### Step 2: Fix invalid market keys

Remove `player_threes_q1` and `player_steals_q1` from batch 4 — these do not exist in the API. The valid Q1 markets for NBA are only: `player_points_q1`, `player_rebounds_q1`, `player_assists_q1`.

Updated NBA batches:
```text
Batch 1: player_points, player_rebounds, player_assists
Batch 2: player_threes, player_blocks, player_steals
Batch 3: player_points_rebounds_assists, player_points_rebounds, player_points_assists, player_rebounds_assists
Batch 4: player_points_q1, player_rebounds_q1, player_assists_q1  (removed 2 invalid keys)
```

### Step 3: Add per-market fallback on 422

If a batched request returns 422, retry each market in the batch individually. This way one bad market doesn't kill the entire batch. This also handles cases where the subscription doesn't support certain markets.

### Step 4: Re-deploy and test

Deploy the fixed scraper, run it in full mode, and check logs for success.

## Files Changed

1. **`supabase/functions/whale-odds-scraper/index.ts`** — Log 422 body, fix invalid Q1 market keys, add per-market fallback on 422 errors

