-- v8.0 FIX #3: Update sync_matchup_history_from_logs to calculate REAL H2H hit rates
-- This replaces the existing function with one that calculates hit_rate_over and hit_rate_under

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
  -- Sync Points H2H with hit rate calculation
  INSERT INTO matchup_history (player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, hit_rate_over, hit_rate_under, last_updated)
  SELECT 
    player_name, 
    opponent, 
    'player_points' as prop_type, 
    COUNT(*) as games_played, 
    ROUND(AVG(points)::numeric, 1) as avg_stat, 
    MAX(points) as max_stat, 
    MIN(points) as min_stat,
    -- Calculate hit rate over common lines (using avg - 2 as proxy for typical line)
    ROUND(AVG(CASE WHEN points > (AVG(points) OVER (PARTITION BY player_name, opponent) - 2) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_over,
    ROUND(AVG(CASE WHEN points < (AVG(points) OVER (PARTITION BY player_name, opponent) + 2) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_under,
    now() as last_updated
  FROM nba_player_game_logs 
  WHERE opponent IS NOT NULL AND opponent NOT IN ('Unknown', '') AND points IS NOT NULL
  GROUP BY player_name, opponent 
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
    
  -- Sync Rebounds H2H with hit rate calculation
  INSERT INTO matchup_history (player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, hit_rate_over, hit_rate_under, last_updated)
  SELECT 
    player_name, 
    opponent, 
    'player_rebounds' as prop_type, 
    COUNT(*) as games_played, 
    ROUND(AVG(rebounds)::numeric, 1) as avg_stat, 
    MAX(rebounds) as max_stat, 
    MIN(rebounds) as min_stat,
    ROUND(AVG(CASE WHEN rebounds > (AVG(rebounds) OVER (PARTITION BY player_name, opponent) - 1) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_over,
    ROUND(AVG(CASE WHEN rebounds < (AVG(rebounds) OVER (PARTITION BY player_name, opponent) + 1) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_under,
    now() as last_updated
  FROM nba_player_game_logs 
  WHERE opponent IS NOT NULL AND opponent NOT IN ('Unknown', '') AND rebounds IS NOT NULL
  GROUP BY player_name, opponent 
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
    
  -- Sync Assists H2H with hit rate calculation
  INSERT INTO matchup_history (player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, hit_rate_over, hit_rate_under, last_updated)
  SELECT 
    player_name, 
    opponent, 
    'player_assists' as prop_type, 
    COUNT(*) as games_played, 
    ROUND(AVG(assists)::numeric, 1) as avg_stat, 
    MAX(assists) as max_stat, 
    MIN(assists) as min_stat,
    ROUND(AVG(CASE WHEN assists > (AVG(assists) OVER (PARTITION BY player_name, opponent) - 1) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_over,
    ROUND(AVG(CASE WHEN assists < (AVG(assists) OVER (PARTITION BY player_name, opponent) + 1) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_under,
    now() as last_updated
  FROM nba_player_game_logs 
  WHERE opponent IS NOT NULL AND opponent NOT IN ('Unknown', '') AND assists IS NOT NULL
  GROUP BY player_name, opponent 
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

  -- Sync Three Pointers H2H with hit rate calculation against common lines (1.5, 2.5)
  INSERT INTO matchup_history (player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, hit_rate_over, hit_rate_under, last_updated)
  SELECT 
    player_name, 
    opponent, 
    'player_threes' as prop_type, 
    COUNT(*) as games_played, 
    ROUND(AVG(threes_made)::numeric, 1) as avg_stat, 
    MAX(threes_made) as max_stat, 
    MIN(threes_made) as min_stat,
    -- For 3PM, use floor(avg) as the typical betting line
    ROUND(AVG(CASE WHEN threes_made > FLOOR(AVG(threes_made) OVER (PARTITION BY player_name, opponent)) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_over,
    ROUND(AVG(CASE WHEN threes_made < CEIL(AVG(threes_made) OVER (PARTITION BY player_name, opponent)) THEN 1.0 ELSE 0.0 END)::numeric, 2) as hit_rate_under,
    now() as last_updated
  FROM nba_player_game_logs 
  WHERE opponent IS NOT NULL AND opponent NOT IN ('Unknown', '') AND threes_made IS NOT NULL
  GROUP BY player_name, opponent 
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