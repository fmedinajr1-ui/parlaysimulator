

## Retest bot-force-fresh-parlays With player_blocks Blocked

Invoke the function and verify logs confirm `player_blocks` picks are now being filtered out.

### Steps

1. **Invoke `bot-force-fresh-parlays`** via edge function curl
2. **Read logs** to confirm:
   - `[BlockedPropType] Filtered player_blocks` entries appear for any blocks props
   - `player_steals` also still filtered
   - Parlays generated without any blocks or steals legs
3. **Report** the results including filtered count and parlay composition

