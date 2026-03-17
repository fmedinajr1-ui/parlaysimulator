

# Get Hedge Recommendations + Bidirectional Scanner Working Tonight

## Current State

| System | Status | Root Cause |
|--------|--------|------------|
| **Parlay Generator** | ❌ Logged `zero_game_day` at 10 AM | Fix is in code but **not deployed yet** |
| **Bidirectional Scanner** | ❌ 0 matchups for today | Same bug — only queries `game_bets` (empty), no fallback |
| **Hedge Recommendations** | ❌ 0 snapshots today | No parlays generated → nothing to track |
| **Data Available** | ✅ 1,783 active props, 742 sweet spots, 30 defense rankings | Data is there, pipelines just can't see it |

The `game_bets` table is empty due to Odds API 401/422 errors, but `unified_props` has all 1,783 props. Both the parlay generator and the bidirectional scanner hard-stop when `game_bets` returns nothing.

## Changes

### 1. Deploy the parlay generator fix (already coded)
The `unified_props` fallback was added in the last edit but never deployed. Deploy `bot-generate-daily-parlays` so the 5:30 PM ET cron picks up the fix.

### 2. Add `game_bets` fallback to bidirectional scanner
**File**: `supabase/functions/bot-matchup-defense-scanner/index.ts` (lines 220-233)

The scanner queries `game_bets` for today's games. When empty, it exits. Add a fallback that derives home/away teams from `unified_props` event descriptions (format: "Team A vs Team B") when `game_bets` returns zero:

```
// If game_bets is empty, derive games from unified_props
if (!rawGames || rawGames.length === 0) {
  // Query distinct event names from unified_props for today
  // Parse "Team A vs Team B" → build game objects
  // Continue with normal flow
}
```

This reuses the same commence_time window already computed.

### 3. Deploy both functions and trigger them manually
After deploying:
- Invoke `bot-matchup-defense-scanner` to populate `matchup_intelligence` for tonight
- Invoke `bot-generate-daily-parlays` (or wait for 5:30 PM ET cron) to generate parlays
- Invoke `morning-prep-pipeline` to confirm all engines are green

### 4. Deploy `morning-prep-pipeline` (already coded, not yet deployed)
This was created in the last session but needs deployment for tomorrow's 10 AM cron.

### Files to Change
| File | Change |
|------|--------|
| `supabase/functions/bot-matchup-defense-scanner/index.ts` | Add `unified_props` fallback when `game_bets` is empty (derive games from event names) |

### Deploy List
| Function | Status |
|----------|--------|
| `bot-generate-daily-parlays` | Deploy existing fix |
| `bot-matchup-defense-scanner` | Deploy after adding fallback |
| `morning-prep-pipeline` | Deploy new function |

