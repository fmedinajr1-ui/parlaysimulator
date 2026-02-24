

## Retest bot-force-fresh-parlays After Fix

Now that the blocklist fix has been deployed (removing `player_blocks` from static blocking) and the 8 stale parlays have been voided, we need to re-invoke the function to verify:

1. Performance data is loading (look for "[ForceFresh] Loaded X blocked prop types, Y player records")
2. `player_blocks` picks are no longer being filtered out
3. Conviction scoring includes player performance bonuses (+15 for proven winners)
4. Fresh parlays are generated with the corrected logic

### Steps

1. **Invoke `bot-force-fresh-parlays`** via the edge function curl tool
2. **Read the edge function logs** to confirm:
   - Performance tables loaded successfully
   - No `[BlockedPropType] Filtered player_blocks` entries appear
   - Conviction scores reflect player bonuses
3. **Report results** including which players and prop types made it into the new parlays

