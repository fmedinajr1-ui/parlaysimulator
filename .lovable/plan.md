

## Settle Remaining 17 Pending Feb 19 Parlays

### What This Does
Re-run the verification and settlement pipeline targeting Feb 19 to catch any legs that were missing stat data during the first pass, then settle the remaining 17 pending parlays.

### Steps

1. **Re-run `backfill-player-stats`** for Feb 19 to pick up any player stats that were missing during the first settlement attempt
2. **Re-run `verify-sweet-spot-outcomes`** for Feb 19 to resolve any remaining unsettled sweet spot picks
3. **Re-run `bot-settle-and-learn`** to settle the 17 remaining pending parlays using the newly available data
4. **Send updated Telegram report** with the full leg breakdown including the newly settled parlays

### No Code Changes Required
This uses the existing edge functions as-is -- just needs to re-trigger them in sequence to process the remaining data.

