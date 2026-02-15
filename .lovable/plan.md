

# Fix Spread Line Signs and Book Accuracy

## Problem
The bot is showing "Arizona +2.5" when the actual FanDuel spread is "Arizona -1.5". Two root causes:

1. **Wrong sign**: Whale signal team spread picks store the line as positive (home team perspective: Michigan +2.5), but never negate it for the away side. When the bot picks Arizona (away), the line should be -2.5, but it stays +2.5 because whale picks flow through the player prop code path, not the team pick path.

2. **Wrong bookmaker line**: The deduplication picks DraftKings (line 2.5) over FanDuel (line 1.5). Since the user bets on FanDuel, the bot should prefer FanDuel lines when available.

## Fix 1: Correct spread sign for whale team picks

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

In the whale pick enrichment (around line 2608-2636):
- Detect team spread/moneyline whale picks (those with `player_name` containing "@" and `stat_type` of spread/total/moneyline)
- For spread picks where `pick_side` is "away", negate the line: `line = -(line)` so Arizona gets -2.5 instead of +2.5
- Remove the `p.line > 0` filter that would reject correctly negated away spread lines -- change to `Math.abs(p.line) > 0`

## Fix 2: Prefer FanDuel lines in deduplication

**File**: `supabase/functions/bot-generate-daily-parlays/index.ts`

In the game_bets deduplication (around line 1983-1992):
- Change dedup key to include bookmaker: prioritize FanDuel over other books
- When multiple bookmakers exist for the same game + bet_type, prefer FanDuel, then DraftKings, then others
- This ensures the line matches what the user actually sees on their sportsbook

## Fix 3: Correct the display in both UI components

**File**: `src/components/bot/DayParlayDetail.tsx` and `src/components/bot/BotParlayCard.tsx`

- Ensure the spread display shows the correct sign based on the stored line value (already partially handled with `leg.line >= 0 ? '+' : ''` formatting, but only works if the line is correctly negative)

## Fix 4: Re-generate today's parlays

After deploying the edge function fix:
- Delete today's parlays (`DELETE FROM bot_daily_parlays WHERE parlay_date = '2026-02-15'`)
- Re-run generation to produce correctly signed spread lines using FanDuel's -1.5 line

## Technical Details

### Whale pick enrichment change (lines ~2608-2636)
```typescript
const enrichedWhalePicks = (rawWhalePicks || []).map((wp: any) => {
  const side = (wp.pick_side || 'over').toLowerCase();
  let line = wp.pp_line || wp.line || 0;
  const isTeamBet = (wp.stat_type === 'spread' || wp.stat_type === 'moneyline' || wp.stat_type === 'total') 
    && wp.player_name?.includes('@');
  
  // For team spread away picks, negate the line (stored as home perspective)
  if (isTeamBet && wp.stat_type === 'spread' && side === 'away') {
    line = -line;
  }
  // ... rest of enrichment
}).filter((p) => Math.abs(p.line) > 0 && p.player_name);
```

### Game bets dedup preference (lines ~1983-1992)
```typescript
// Prefer fanduel > draftkings > others
const BOOK_PRIORITY: Record<string, number> = { fanduel: 3, draftkings: 2 };
const getBookPriority = (b: string) => BOOK_PRIORITY[b?.toLowerCase()] || 1;

for (const game of rawTeamProps) {
  const key = `${game.home_team}_${game.away_team}_${game.bet_type}`;
  const existing = seenGameBets.get(key);
  if (!existing || getBookPriority(game.bookmaker) > getBookPriority(existing.bookmaker)) {
    seenGameBets.set(key, game);
  }
}
```

This ensures: Arizona -1.5 (FanDuel) instead of Arizona +2.5 (wrong sign, wrong book).

