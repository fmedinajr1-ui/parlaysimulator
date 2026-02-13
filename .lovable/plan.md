
# Fix Baseball Parlay Generation + Clean Up NCAAB Player Prop Parlays

## Problem 1: No Baseball Parlays Generated
The synthetic baseball test data in `game_bets` has `commence_time` set to **Feb 15**, not today (Feb 13). The bot's query filters team bets to today's UTC window (`startUtc` to `endUtc`), so baseball picks are invisible to the generator.

**Fix**: Update the `commence_time` on all 8 baseball test records to today's date so they fall within the bot's daily window. Then regenerate parlays.

## Problem 2: NCAAB Player Prop Parlays Polluting P&L
Old parlays from Feb 9-11 contain NCAAB player props (Carson Cooper, Coen Carr, John Blackwell, Jaxon Kohler - all `basketball_ncaab` players). Many are marked `void` or `lost`, which inflates the loss count in the P&L calendar and dashboard.

**Fix**: Delete all `bot_daily_parlays` records that contain NCAAB player prop legs. These can be identified by checking if any leg has a `player_name` set AND `sport = basketball_ncaab` in the legs JSON.

## Steps

1. **Delete all parlays containing NCAAB player props** from `bot_daily_parlays` (any date). This cleans the P&L history.

2. **Update baseball test data** - change `commence_time` on the 8 `baseball_ncaa` records in `game_bets` to today (Feb 13) so the bot can pick them up.

3. **Clear today's parlays** from `bot_daily_parlays` (the 5 NCAAB-only team bet parlays) to allow a fresh generation that includes baseball.

4. **Regenerate today's parlays** - trigger `bot-generate-daily-parlays` to produce a new batch that should now include baseball profiles alongside NCAAB team bets.

## Technical Details

### SQL: Remove NCAAB player prop parlays
```sql
DELETE FROM bot_daily_parlays 
WHERE id IN (
  SELECT id FROM bot_daily_parlays 
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(legs) AS leg 
    WHERE leg->>'sport' = 'basketball_ncaab' 
    AND leg->>'player_name' IS NOT NULL
  )
);
```

### SQL: Fix baseball commence times
```sql
UPDATE game_bets 
SET commence_time = '2026-02-13T19:00:00Z' 
WHERE sport = 'baseball_ncaa' AND home_team = 'LSU Tigers';

UPDATE game_bets 
SET commence_time = '2026-02-13T21:00:00Z' 
WHERE sport = 'baseball_ncaa' AND home_team = 'Vanderbilt Commodores';

UPDATE game_bets 
SET commence_time = '2026-02-13T23:00:00Z' 
WHERE sport = 'baseball_ncaa' AND home_team = 'Florida Gators';
```

### Regeneration
Delete today's 5 parlays, then trigger `bot-generate-daily-parlays` to rebuild with baseball included.
