
## Fix: Defensive Matchup Not Showing in /lookup

### Root Cause
The fallback query to `game_bets` (used when no props exist for a player) has **two bugs** that cause it to always return zero rows:

1. **Wrong sport filter**: Code uses `.eq('sport', 'NBA')` but the actual column values are `'basketball_nba'`
2. **Wrong date column**: Code filters on `event_date` which **does not exist** in the table — the correct column is `commence_time`

Because this query always fails silently, `opponentAbbrev` stays null, and the defense section is skipped.

### Fix (2 lines in one file)

**File:** `supabase/functions/telegram-webhook/index.ts` (lines ~3399-3405)

Change the `game_bets` fallback query from:
```typescript
.eq('sport', 'NBA')
.gte('event_date', `${today}T00:00:00`)
.lte('event_date', `${today}T23:59:59`)
```

To:
```typescript
.eq('sport', 'basketball_nba')
.gte('commence_time', `${today}T00:00:00`)
.lte('commence_time', `${today}T23:59:59`)
```

### Expected Result
- `/lookup [player]` will now correctly find tonight's opponent from the game schedule
- The defensive ranking block (overall, PTS, 3PT, REB, AST ranks) will appear for any player with a game today
- No other code changes needed — the rest of the pipeline (defense fetch, section formatting) is already correct
