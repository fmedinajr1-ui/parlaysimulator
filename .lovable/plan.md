

## Fetch Hard Rock Bet Longshot Odds (+650 and up)

### What We'll Do
Create a backend function that pulls all current Hard Rock Bet odds at +650 or higher across NBA games, then invoke it immediately and display the results here in chat.

### Technical Details

**New file: `supabase/functions/fetch-hardrock-longshots/index.ts`**
- Queries The Odds API for all active NBA events with `hardrockbet` as the bookmaker
- Requests moneyline (`h2h`) and key player prop markets (points, rebounds, assists, threes, PRA, steals, blocks)
- Filters all outcomes for American odds >= +650
- Returns structured results: player/team name, prop type, line, odds, event info

**Invocation**
- Deploy the function (automatic)
- Invoke it immediately via the edge function tools
- Display results directly in chat

### Caveat
If Hard Rock Bet isn't active in The Odds API for today's events, the response will be empty. This depends entirely on their API coverage of HRB.

