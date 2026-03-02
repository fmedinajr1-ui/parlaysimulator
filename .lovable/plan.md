

# Fix Opponent Resolution in /lookup Command

## Problem
The `/lookup` command shows "vs SAC" (Sacramento Kings) instead of "vs SAS" (San Antonio Spurs) for Knicks players. The root cause is fragile opponent resolution that depends on `bdl_player_cache` team data (which can be stale after trades) and then fuzzy-matching through `game_bets`.

## Solution
Add a more reliable opponent resolution chain using the `nba_player_game_logs.opponent` column, which comes directly from ESPN box scores.

## Changes

**Single file:** `supabase/functions/telegram-webhook/index.ts`

### 1. Add game log opponent as the highest-priority source (new Priority A0)
Before checking `unified_props` or `game_bets`, check if today's game log already exists for the player. If the game has started or finished, the `opponent` field gives us the exact opponent with zero ambiguity.

```
// Priority A0: Direct from today's game log (most reliable)
const todayLog = playerLogs.find(g => String(g.game_date) === today);
if (todayLog && todayLog.opponent) {
  opponentAbbrev = resolveTeamAbbrev(todayLog.opponent);
  opponentSource = 'game_log';
}
```

### 2. Add player team resolution from game logs as fallback
If `bdl_player_cache` has stale data, resolve the player's team by checking who they played at home vs away in recent game logs. The `is_home` field combined with the opponent tells us the player's team indirectly.

### 3. Add defensive logging for the full resolution chain
Log which source resolved the opponent (`game_log`, `props`, `game_bets`) so future mismatches are easier to debug.

### 4. Add cross-validation
If both game_log and game_bets resolve an opponent, and they disagree, prefer the game_log source and log a warning.

## Technical Details

| Step | Source | Reliability | When Available |
|------|--------|-------------|----------------|
| A0 (new) | `nba_player_game_logs.opponent` for today | Highest | After game starts |
| A | `unified_props.game_description` | High | When props are scraped |
| B | `game_bets` schedule | Medium | Pre-game |

The game log approach also fixes the related issue where `bdl_player_cache` may have a stale team for traded players, since we no longer depend on knowing the player's team to find their opponent -- we get it directly.

