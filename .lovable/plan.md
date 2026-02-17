
# Re-Run Pipeline with Team Concentration Cap

## Current State (Pre-Fix Run)
The 24 parlays currently in the database were generated **before** the team cap was deployed. They still show the old over-concentration:

| Team | Appearances (current) | Target |
|------|----------------------|--------|
| SMU Mustangs | 15 | ≤ 4 |
| Louisville Cardinals | 15 | ≤ 4 |
| Florida Gators | 10 | ≤ 4 |
| South Carolina Gamecocks | 10 | ≤ 4 |
| Rhode Island Rams | 9 | ≤ 4 |
| NC State Wolfpack | 9 | ≤ 4 |

The `globalTeamUsage` cap code is already live in the edge function — we just need a clean re-run.

## Steps

### Step 1 — Delete today's existing parlays
```sql
DELETE FROM bot_daily_parlays WHERE parlay_date = '2026-02-17';
```

### Step 2 — Re-run the generator
Invoke `bot-generate-daily-parlays` for Feb 17. With the new cap logic:
- Any team hitting 4 parlays will be blocked from further appearances
- Today is a light slate (fewer than 10 top-ranked picks), so the cap relaxes to 6
- The generator will pull from more of the 26 available NCAAB games to fill the pool

### Step 3 — Run the optimizer
Invoke `bot-review-and-optimize` to top up to the minimum floor (12+ parlays).

### Step 4 — Verify
Query `bot_daily_parlays` for Feb 17 and confirm:
- Total parlay count ≥ 12
- No team (via `home_team` / `away_team` fields) appears more than 6 times (light slate cap)
- SMU and Florida each appear ≤ 6 times

## Technical Notes
- The cap is 6 (not 4) today because this is a light slate — fewer than 10 qualifying picks widened the rank cutoff to Top 300
- The check uses `home_team` and `away_team` columns on each leg, normalized to lowercase — matching exactly how the generator tracks and enforces the cap
- No code changes needed; the fix is already deployed
