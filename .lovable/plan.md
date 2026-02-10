

# Fix Team Bets Display and Parlay Integration

## Problems Identified

### 1. Team bets never show recommended side, sharp score, or clear pick direction
All 252 records in `game_bets` have `recommended_side: NULL` and `sharp_score: NULL`. The root cause is a **parsing bug** in the `whale-signal-detector` edge function.

The `market_key` format is: `team_basketball_nba_GAMEID_spread`

But the code extracts `game_id` with `signal.market_key.split('_')[2]`, which returns `"nba"` instead of the actual game ID. So the `UPDATE` to `game_bets` never matches any rows, leaving all sharp scores and recommended sides null.

### 2. TeamBetCard doesn't clearly show the recommended pick
Even if the data were populated, the card only highlights the recommended badge slightly (filled vs outline). There's no clear "PICK" callout telling the user which side to take and why.

### 3. Team picks in parlays don't show side/odds in Telegram
The `/parlays`, `/explore`, `/validate` commands show team legs as just a team name. They don't display bet type, side (HOME/AWAY, OVER/UNDER), line, or odds -- making the parlay details useless for team legs.

### 4. Team picks in bot generation don't filter for plus-odds diversity
The `bot-generate-daily-parlays` enrichment doesn't prioritize plus-money team picks for diversified parlays, which was requested.

---

## Changes

### File 1: `supabase/functions/whale-signal-detector/index.ts` (line ~456)
**Fix the game_id extraction bug.** The market_key has the format `team_SPORT_GAMEID_BETTYPE` where SPORT itself contains underscores. Instead of splitting by `_`, extract the game_id directly from the source data.

- Store `game_id` on each team signal object during construction (line ~397)
- Use that stored `game_id` in the update loop instead of parsing `market_key`

### File 2: `src/components/team-bets/TeamBetCard.tsx`
**Add a clear recommended pick display:**
- Show a prominent "PICK" badge with the recommended side (e.g., "HOME -3.5", "OVER 215.5", "AWAY ML")
- Display the sharp score as a percentage bar or bold number when available
- For spreads: clearly label which team to take and at what line
- For totals: clearly label OVER or UNDER with the number
- For moneyline: clearly label which team and odds

### File 3: `supabase/functions/telegram-webhook/index.ts`
**Enhance team leg display in parlay commands:**
- Update the `/explore` and `/validate` handlers to show team legs with bet type, side, line, and odds
- Format team legs as: `LAL @ BOS Spread HOME -3.5 (+110)` instead of just team name
- Add a `/parlay #N` command to view individual parlay details with full leg breakdown

### File 4: `supabase/functions/bot-generate-daily-parlays/index.ts`
**Add plus-odds filtering for team picks:**
- During team pick enrichment, flag picks with positive American odds
- In the team profile parlay builder, prioritize plus-money picks for diversity profiles
- Ensure team legs in the stored parlay data include descriptive info (team names, bet type, side, line)

---

## Technical Details

### Whale signal detector fix
```typescript
// Before (broken):
const gameId = signal.market_key.split('_')[2]; // Returns 'nba', not game_id

// After (fixed):
// Store game_id on the signal during construction
teamSignals.push({
  ...signalData,
  _game_id: firstBet.game_id, // stored for update loop
});

// In update loop:
await supabase
  .from('game_bets')
  .update({ sharp_score, recommended_side, signal_sources })
  .eq('game_id', signal._game_id)
  .eq('bet_type', signal.stat_type);
```

### TeamBetCard pick display
Add a clear "Recommended Pick" section that shows:
- For spread: "Take [Team] [Line] ([Odds])"
- For total: "Take OVER/UNDER [Line] ([Odds])"
- For moneyline: "Take [Team] ([Odds])"

Only shown when `recommended_side` is not null.

### Telegram team leg formatting
```typescript
// For team legs in parlay display:
if (leg.type === 'team') {
  const sideLabel = leg.side === 'home' ? leg.home_team : 
                    leg.side === 'away' ? leg.away_team :
                    leg.side?.toUpperCase();
  const odds = leg.american_odds > 0 ? `+${leg.american_odds}` : leg.american_odds;
  return `${sideLabel} ${leg.bet_type} ${leg.line} (${odds})`;
}
```

### Plus-odds team pick prioritization
In the team enrichment, add an `isPlusMoney` flag and boost `compositeScore` by +5 for plus-money picks to ensure they appear higher in candidate selection for diverse profiles.

### Deployment
Redeploy: `whale-signal-detector`, `telegram-webhook`, `bot-generate-daily-parlays`
