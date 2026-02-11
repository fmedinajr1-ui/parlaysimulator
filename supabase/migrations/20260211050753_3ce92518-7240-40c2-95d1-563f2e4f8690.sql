
CREATE OR REPLACE FUNCTION public.sync_matchup_history_from_logs()
 RETURNS TABLE(players_synced integer, prop_types_synced integer, total_records integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_players_synced INTEGER := 0;
  v_prop_types_synced INTEGER := 0;
  v_total_records INTEGER := 0;
BEGIN
  -- Sync Points H2H with hit rate calculation (CTE approach)
  WITH avgs AS (
    SELECT player_name, opponent, AVG(points) as avg_stat
    FROM nba_player_game_logs
    WHERE opponent IS NOT NULL AND opponent NOT IN ('Unknown', '') AND points IS NOT NULL
    GROUP BY player_name, opponent
    HAVING COUNT(*) >= 2
  )
  INSERT INTO matchup_history (player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, hit_rate_over, hit_rate_under, last_updated)
  SELECT 
    g.player_name, 
    g.opponent, 
    'player_points' as prop_type, 
    COUNT(*) as games_played, 
    ROUND(AVG(g.points)::numeric, 1) as avg_stat, 
    MAX(g.points) as max_stat, 
    MIN(g.points) as min_stat,
    ROUND(AVG(CASE WHEN g.points > (a.avg_stat - 2) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_over,
    ROUND(AVG(CASE WHEN g.points < (a.avg_stat + 2) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_under,
    now() as last_updated
  FROM nba_player_game_logs g
  JOIN avgs a ON g.player_name = a.player_name AND g.opponent = a.opponent
  WHERE g.opponent IS NOT NULL AND g.opponent NOT IN ('Unknown', '') AND g.points IS NOT NULL
  GROUP BY g.player_name, g.opponent, a.avg_stat
  HAVING COUNT(*) >= 2
  ON CONFLICT (player_name, opponent, prop_type) DO UPDATE SET
    games_played = EXCLUDED.games_played, 
    avg_stat = EXCLUDED.avg_stat,
    max_stat = EXCLUDED.max_stat, 
    min_stat = EXCLUDED.min_stat, 
    hit_rate_over = EXCLUDED.hit_rate_over,
    hit_rate_under = EXCLUDED.hit_rate_under,
    last_updated = now();
  
  GET DIAGNOSTICS v_total_records = ROW_COUNT;
    
  -- Sync Rebounds H2H with hit rate calculation (CTE approach)
  WITH avgs AS (
    SELECT player_name, opponent, AVG(rebounds) as avg_stat
    FROM nba_player_game_logs
    WHERE opponent IS NOT NULL AND opponent NOT IN ('Unknown', '') AND rebounds IS NOT NULL
    GROUP BY player_name, opponent
    HAVING COUNT(*) >= 2
  )
  INSERT INTO matchup_history (player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, hit_rate_over, hit_rate_under, last_updated)
  SELECT 
    g.player_name, 
    g.opponent, 
    'player_rebounds' as prop_type, 
    COUNT(*) as games_played, 
    ROUND(AVG(g.rebounds)::numeric, 1) as avg_stat, 
    MAX(g.rebounds) as max_stat, 
    MIN(g.rebounds) as min_stat,
    ROUND(AVG(CASE WHEN g.rebounds > (a.avg_stat - 1) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_over,
    ROUND(AVG(CASE WHEN g.rebounds < (a.avg_stat + 1) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_under,
    now() as last_updated
  FROM nba_player_game_logs g
  JOIN avgs a ON g.player_name = a.player_name AND g.opponent = a.opponent
  WHERE g.opponent IS NOT NULL AND g.opponent NOT IN ('Unknown', '') AND g.rebounds IS NOT NULL
  GROUP BY g.player_name, g.opponent, a.avg_stat
  HAVING COUNT(*) >= 2
  ON CONFLICT (player_name, opponent, prop_type) DO UPDATE SET
    games_played = EXCLUDED.games_played, 
    avg_stat = EXCLUDED.avg_stat,
    max_stat = EXCLUDED.max_stat, 
    min_stat = EXCLUDED.min_stat,
    hit_rate_over = EXCLUDED.hit_rate_over,
    hit_rate_under = EXCLUDED.hit_rate_under,
    last_updated = now();
  
  GET DIAGNOSTICS v_prop_types_synced = ROW_COUNT;
  v_total_records := v_total_records + v_prop_types_synced;
    
  -- Sync Assists H2H with hit rate calculation (CTE approach)
  WITH avgs AS (
    SELECT player_name, opponent, AVG(assists) as avg_stat
    FROM nba_player_game_logs
    WHERE opponent IS NOT NULL AND opponent NOT IN ('Unknown', '') AND assists IS NOT NULL
    GROUP BY player_name, opponent
    HAVING COUNT(*) >= 2
  )
  INSERT INTO matchup_history (player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, hit_rate_over, hit_rate_under, last_updated)
  SELECT 
    g.player_name, 
    g.opponent, 
    'player_assists' as prop_type, 
    COUNT(*) as games_played, 
    ROUND(AVG(g.assists)::numeric, 1) as avg_stat, 
    MAX(g.assists) as max_stat, 
    MIN(g.assists) as min_stat,
    ROUND(AVG(CASE WHEN g.assists > (a.avg_stat - 1) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_over,
    ROUND(AVG(CASE WHEN g.assists < (a.avg_stat + 1) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_under,
    now() as last_updated
  FROM nba_player_game_logs g
  JOIN avgs a ON g.player_name = a.player_name AND g.opponent = a.opponent
  WHERE g.opponent IS NOT NULL AND g.opponent NOT IN ('Unknown', '') AND g.assists IS NOT NULL
  GROUP BY g.player_name, g.opponent, a.avg_stat
  HAVING COUNT(*) >= 2
  ON CONFLICT (player_name, opponent, prop_type) DO UPDATE SET
    games_played = EXCLUDED.games_played, 
    avg_stat = EXCLUDED.avg_stat,
    max_stat = EXCLUDED.max_stat, 
    min_stat = EXCLUDED.min_stat,
    hit_rate_over = EXCLUDED.hit_rate_over,
    hit_rate_under = EXCLUDED.hit_rate_under,
    last_updated = now();
  
  GET DIAGNOSTICS v_prop_types_synced = ROW_COUNT;
  v_total_records := v_total_records + v_prop_types_synced;

  -- Sync Three Pointers H2H with hit rate calculation (CTE approach)
  WITH avgs AS (
    SELECT player_name, opponent, AVG(threes_made) as avg_stat
    FROM nba_player_game_logs
    WHERE opponent IS NOT NULL AND opponent NOT IN ('Unknown', '') AND threes_made IS NOT NULL
    GROUP BY player_name, opponent
    HAVING COUNT(*) >= 2
  )
  INSERT INTO matchup_history (player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, hit_rate_over, hit_rate_under, last_updated)
  SELECT 
    g.player_name, 
    g.opponent, 
    'player_threes' as prop_type, 
    COUNT(*) as games_played, 
    ROUND(AVG(g.threes_made)::numeric, 1) as avg_stat, 
    MAX(g.threes_made) as max_stat, 
    MIN(g.threes_made) as min_stat,
    ROUND(AVG(CASE WHEN g.threes_made > FLOOR(a.avg_stat) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_over,
    ROUND(AVG(CASE WHEN g.threes_made < CEIL(a.avg_stat) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_under,
    now() as last_updated
  FROM nba_player_game_logs g
  JOIN avgs a ON g.player_name = a.player_name AND g.opponent = a.opponent
  WHERE g.opponent IS NOT NULL AND g.opponent NOT IN ('Unknown', '') AND g.threes_made IS NOT NULL
  GROUP BY g.player_name, g.opponent, a.avg_stat
  HAVING COUNT(*) >= 2
  ON CONFLICT (player_name, opponent, prop_type) DO UPDATE SET
    games_played = EXCLUDED.games_played, 
    avg_stat = EXCLUDED.avg_stat,
    max_stat = EXCLUDED.max_stat, 
    min_stat = EXCLUDED.min_stat,
    hit_rate_over = EXCLUDED.hit_rate_over,
    hit_rate_under = EXCLUDED.hit_rate_under,
    last_updated = now();
  
  GET DIAGNOSTICS v_prop_types_synced = ROW_COUNT;
  v_total_records := v_total_records + v_prop_types_synced;

  -- Count unique players synced
  SELECT COUNT(DISTINCT player_name) INTO v_players_synced FROM matchup_history;
  
  RETURN QUERY SELECT v_players_synced, 4, v_total_records;
END;
$function$;
