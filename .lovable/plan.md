

# Fix Corrupted Quarter Snapshot Data

## Root Cause

The `auto-quarter-snapshots` fix (assign delta to latest quarter only) is in the codebase, but **all existing data was captured before the fix was deployed**. Evidence:

- Wembanyama (401810828): 8 pts / 3 reb / 2 ast in Q1, Q2, Q3, Q4 — identical, clearly evenly divided
- Jokic (401810675): 12 pts / 7 reb / 4 ast in Q1, Q2, Q3 — identical
- The function sees "all completed quarters already captured" and skips them, so the bad data never gets corrected

Since `get-player-quarter-profile` computes L3 quarter averages from this corrupted snapshot data, the quarter breakdown numbers shown on prop cards are wrong.

## Fix Plan

### 1. Purge corrupted snapshots and re-deploy the fixed function

**Database**: Delete all existing `quarter_player_snapshots` rows that were captured with even distribution. Since we can't distinguish good from bad programmatically (they all have the same `captured_at` per batch), and all existing data predates the fix, the safest approach is to **truncate the table entirely**.

```sql
TRUNCATE TABLE public.quarter_player_snapshots;
```

### 2. Redeploy `auto-quarter-snapshots` edge function

Ensure the latest code (with the `isLastQuarter` fix) is actually deployed. The function will then capture fresh, accurate per-quarter deltas going forward as games progress tonight and future nights.

### 3. Redeploy `get-player-quarter-profile` edge function

Ensure the L3 snapshot-based averaging code is deployed. Until new snapshot data accumulates (after 2+ games), it will fall back to the tier-based distribution using L3 game logs — which is still better than averaging corrupted data.

### 4. No code changes needed

The code in both edge functions is already correct. This is purely a deployment + data cleanup issue.

## Summary

| Action | Detail |
|--------|--------|
| Truncate `quarter_player_snapshots` | Remove all corrupted even-distribution data |
| Redeploy `auto-quarter-snapshots` | Ensure the `isLastQuarter` delta fix is live |
| Redeploy `get-player-quarter-profile` | Ensure L3 real-data averaging is live |

After this, fresh snapshots will be captured correctly during tonight's games. Quarter averages will use the tier-based fallback until 2+ games of clean snapshot data exist.

