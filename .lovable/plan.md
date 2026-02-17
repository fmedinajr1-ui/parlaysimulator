

# Re-run Today's Pipeline with Updated Logic

Now that the light-slate mixing and dynamic rank cutoff are deployed, we need to:

1. **Delete existing Feb 17 parlays** to start fresh
2. **Re-run the parlay generator** with the new logic (dynamic rank cutoff 200->300 on light slates, raised game/matchup caps, minimum 12 parlay floor)

## Steps

### Step 1: Clear today's parlays
```sql
DELETE FROM bot_daily_parlays WHERE parlay_date = '2026-02-17';
```

### Step 2: Re-run the generator
Invoke `bot-generate-daily-parlays` which will now:
- Detect the light slate (fewer than 10 picks at Top 200 cutoff)
- Widen to Top 300, pulling in mid-major matchups
- Mix picks aggressively with raised caps (6 per game, 5 per matchup)
- Generate at least 12 parlays from today's 26 NCAAB games

### Step 3: Verify results
Query `bot_daily_parlays` for Feb 17 to confirm the new count and check that picks span more games than before.

