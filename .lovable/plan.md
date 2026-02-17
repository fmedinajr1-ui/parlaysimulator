
# Delete Feb 17 Parlays & Re-Run with Team Cap

## Current State Confirmed
The 24 existing parlays were generated **before** the team concentration cap was deployed. The over-concentration is still present:

| Team | Current Appearances | Target (Light Slate) |
|------|--------------------|--------------------|
| SMU Mustangs | 15 | ≤ 6 |
| Louisville Cardinals | 15 | ≤ 6 |
| Florida Gators | 10 | ≤ 6 |
| South Carolina Gamecocks | 10 | ≤ 6 |
| Saint Louis Billikens | 9 | ≤ 6 |
| NC State Wolfpack | 9 | ≤ 6 |

The `globalTeamUsage` cap is **already deployed** in the edge function — we just need a clean slate to re-run.

## Execution Steps

### Step 1 — Delete Feb 17 Parlays
```sql
DELETE FROM bot_daily_parlays WHERE parlay_date = '2026-02-17';
```
This clears all 24 existing over-concentrated parlays so the generator starts fresh.

### Step 2 — Re-Run bot-generate-daily-parlays
Invoke the generator edge function. With the new cap active:
- Any team reaching 6 appearances (light slate cap) is blocked from further inclusion
- The generator will draw from a wider pool of the 26 available NCAAB games
- Expect a more diverse set of teams across the output

### Step 3 — Run bot-review-and-optimize
The optimizer tops up the pool to the minimum floor of 12+ parlays, also subject to the same team cap enforcement.

### Step 4 — Verify
Query the new parlays and confirm:
- Total count ≥ 12
- No team appears more than 6 times
- SMU and Florida specifically are each ≤ 6 appearances

## Technical Notes
- Today triggers **Light Slate Mode** (fewer than 10 top-ranked qualifying picks), which sets the team cap to 6 instead of the normal 4
- Both `home_team` and `away_team` fields on every leg are normalized to lowercase before counting — matching exactly how the generator tracks internally
- The existing game-level cap (MAX_GAME_USAGE) and matchup cap (MAX_MATCHUP_USAGE) remain active alongside the new team cap
- No code changes are needed — only data needs to be cleared and re-generated
