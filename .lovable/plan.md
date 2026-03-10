

## Problem: Bidirectional Scanner Shows Zero Players

### Root Cause

The L3 gate filter (added in v11.0, line 262) **blocks every player without L3 data**:

```typescript
if (l3Avg === null) {
  console.log(`[L3Gate] Skipped ${playerName} ${pt}: no L3 data`);
  continue;  // ← kills the player
}
```

**The numbers tell the story:**
- **1,889** active sweet spots with 60%+ L10 hit rate
- **Only 4** have `l3_avg` populated (Cameron Johnson, Christian Braun, Dean Wade, Donovan Mitchell — all on CLE/DEN, neither playing today)
- **99.8% of players are blocked** by the L3 null check

The L3 gate was intended as a recency quality filter, but since `l3_avg` is only populated for a tiny fraction of sweet spots, it effectively kills all player-backed targets.

### Fix

Change the L3 gate from **hard block** to **soft preference**:

1. **In `bot-matchup-defense-scanner/index.ts` (line 262-265)**: Instead of `continue` when `l3_avg === null`, allow the player through but mark them as "no L3 data." Only apply the decline ratio filter (lines 266-270) when L3 data IS available.

```typescript
// BEFORE (blocks 99.8% of players):
if (l3Avg === null) {
  console.log(`[L3Gate] Skipped ${playerName} ${pt}: no L3 data`);
  continue;
}

// AFTER (soft gate — L3 enhances but doesn't block):
if (l3Avg !== null && l10Avg > 0) {
  const declineRatio = l3Avg / l10Avg;
  if (side === 'over' && declineRatio < 0.75) continue;
  if (side === 'under' && declineRatio > 1.25) continue;
}
```

2. **Redeploy and re-invoke** `nba-matchup-daily-broadcast` to regenerate today's scan with player-backed targets.

3. **Verify** that recommendations now have `player_backed: true` and populated `player_targets` arrays.

### Impact
- All 1,889 eligible sweet spot players become candidates again
- Players WITH L3 data still get the recency decline filter (no regression)
- Players WITHOUT L3 data pass through on L10 stats alone (the original behavior before v11.0)
- Today's 11-game slate should produce dozens of player-backed matchup targets

### Files Changed
1. `supabase/functions/bot-matchup-defense-scanner/index.ts` — soften L3 gate (lines 261-270)

