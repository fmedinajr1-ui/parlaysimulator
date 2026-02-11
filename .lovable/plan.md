

## Fix: `sync_matchup_history_from_logs` SQL Function

### Problem
The `sync-matchup-history` step fails with:
```
aggregate function calls cannot contain window function calls
```

The RPC function tries to use `AVG(points) OVER (PARTITION BY ...)` inside `AVG(CASE WHEN ...)`, which PostgreSQL does not allow.

This pattern is repeated 4 times in the function (points, rebounds, assists, three-pointers).

### Solution
Replace the single-pass query with a **CTE (Common Table Expression)** approach:

1. First CTE computes the per-group average (what the window function was trying to do)
2. Second query joins against it to calculate hit rates

### Example Fix (for points, same pattern for all 4 stat types)

```text
Before (broken):
  AVG(CASE WHEN points > (AVG(points) OVER (PARTITION BY player_name, opponent) - 2) THEN 1.0 ELSE 0.0 END) as hit_rate_over

After (fixed):
  WITH avgs AS (
    SELECT player_name, opponent, AVG(points) as avg_points
    FROM nba_player_game_logs
    WHERE opponent IS NOT NULL AND opponent NOT IN ('Unknown', '') AND points IS NOT NULL
    GROUP BY player_name, opponent
    HAVING COUNT(*) >= 2
  )
  SELECT
    g.player_name, g.opponent,
    'player_points' as prop_type,
    COUNT(*) as games_played,
    ROUND(AVG(g.points)::numeric, 1) as avg_stat,
    MAX(g.points) as max_stat,
    MIN(g.points) as min_stat,
    ROUND(AVG(CASE WHEN g.points > (a.avg_points - 2) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_over,
    ROUND(AVG(CASE WHEN g.points < (a.avg_points + 2) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_under,
    now() as last_updated
  FROM nba_player_game_logs g
  JOIN avgs a ON g.player_name = a.player_name AND g.opponent = a.opponent
  WHERE g.opponent IS NOT NULL AND g.opponent NOT IN ('Unknown', '') AND g.points IS NOT NULL
  GROUP BY g.player_name, g.opponent, a.avg_points
  HAVING COUNT(*) >= 2
```

### Steps
1. **Drop and recreate** the `sync_matchup_history_from_logs` function with the CTE-based approach for all 4 stat types (points, rebounds, assists, three-pointers)
2. **Re-run the cascade runner** to verify 18/18 steps pass

### Technical Details
- Database migration: `CREATE OR REPLACE FUNCTION sync_matchup_history_from_logs()` with fixed SQL
- No edge function code changes needed -- the `sync-matchup-history` edge function just calls the RPC
- All 4 INSERT blocks (points, rebounds, assists, threes) have the same bug and need the same fix

