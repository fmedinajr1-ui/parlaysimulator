

# Add FFG Data to Matchup Broadcast

## Problem
1. `bot-matchup-defense-scanner` only writes to DB -- no Telegram
2. `nba-matchup-daily-broadcast` handles Telegram but doesn't format FFG scores
3. Invoking the scanner directly skips the broadcast entirely

## Plan

### Modify `nba-matchup-daily-broadcast/index.ts`

**Update `formatEntry` function** to include FFG data from player targets:
- Show FFG score and label (elite/strong/neutral/weak) next to each player line
- Show shooting volume context: L10 FGA and 3PA
- Example output: `✅ SGA OVER 30.5 (L10: 31.2 avg, 85% hit) | FFG: +6.2 🔥 Elite (14.3 FGA, 5.1 3PA)`

**Update message header** to include FFG summary stats:
- Count of FFG elite/strong targets in the scan
- Add FFG legend to the footer

### File Changed

| File | Change |
|------|--------|
| `supabase/functions/nba-matchup-daily-broadcast/index.ts` | Add FFG score/label/volume to player target formatting in `formatEntry()` |

After updating, invoke `nba-matchup-daily-broadcast` to trigger a full scan + Telegram delivery with FFG data.

