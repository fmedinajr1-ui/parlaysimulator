-- Create hedge_parlays table
CREATE TABLE IF NOT EXISTS public.hedge_parlays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parlay_date DATE NOT NULL,
  parlay_type TEXT NOT NULL CHECK (parlay_type IN ('CONSERVATIVE', 'BALANCED', 'AGGRESSIVE')),
  legs JSONB NOT NULL DEFAULT '[]',
  hedge_score NUMERIC,
  correlation_score NUMERIC,
  h2h_confidence NUMERIC,
  total_odds INTEGER,
  outcome TEXT DEFAULT 'pending',
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(parlay_date, parlay_type)
);

-- Enable RLS
ALTER TABLE public.hedge_parlays ENABLE ROW LEVEL SECURITY;

-- Public read policy
CREATE POLICY "Hedge parlays are viewable by everyone" 
ON public.hedge_parlays FOR SELECT USING (true);

-- Create function to sync matchup history from game logs
CREATE OR REPLACE FUNCTION public.sync_matchup_history_from_logs()
RETURNS TABLE(
  players_synced INTEGER,
  prop_types_synced INTEGER,
  total_records INTEGER
) AS $$
DECLARE
  v_players_synced INTEGER := 0;
  v_prop_types_synced INTEGER := 0;
  v_total_records INTEGER := 0;
BEGIN
  -- Sync Points H2H
  INSERT INTO matchup_history (player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, last_updated)
  SELECT 
    player_name, 
    opponent, 
    'player_points' as prop_type, 
    COUNT(*) as games_played, 
    ROUND(AVG(points)::numeric, 1) as avg_stat, 
    MAX(points) as max_stat, 
    MIN(points) as min_stat,
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
    last_updated = now();
  
  GET DIAGNOSTICS v_total_records = ROW_COUNT;
    
  -- Sync Rebounds H2H
  INSERT INTO matchup_history (player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, last_updated)
  SELECT 
    player_name, 
    opponent, 
    'player_rebounds' as prop_type, 
    COUNT(*) as games_played, 
    ROUND(AVG(rebounds)::numeric, 1) as avg_stat, 
    MAX(rebounds) as max_stat, 
    MIN(rebounds) as min_stat,
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
    last_updated = now();
  
  GET DIAGNOSTICS v_prop_types_synced = ROW_COUNT;
  v_total_records := v_total_records + v_prop_types_synced;
    
  -- Sync Assists H2H
  INSERT INTO matchup_history (player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, last_updated)
  SELECT 
    player_name, 
    opponent, 
    'player_assists' as prop_type, 
    COUNT(*) as games_played, 
    ROUND(AVG(assists)::numeric, 1) as avg_stat, 
    MAX(assists) as max_stat, 
    MIN(assists) as min_stat,
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
    last_updated = now();
  
  GET DIAGNOSTICS v_prop_types_synced = ROW_COUNT;
  v_total_records := v_total_records + v_prop_types_synced;

  -- Sync Three Pointers H2H
  INSERT INTO matchup_history (player_name, opponent, prop_type, games_played, avg_stat, max_stat, min_stat, last_updated)
  SELECT 
    player_name, 
    opponent, 
    'player_threes' as prop_type, 
    COUNT(*) as games_played, 
    ROUND(AVG(three_pointers_made)::numeric, 1) as avg_stat, 
    MAX(three_pointers_made) as max_stat, 
    MIN(three_pointers_made) as min_stat,
    now() as last_updated
  FROM nba_player_game_logs 
  WHERE opponent IS NOT NULL AND opponent NOT IN ('Unknown', '') AND three_pointers_made IS NOT NULL
  GROUP BY player_name, opponent 
  HAVING COUNT(*) >= 2
  ON CONFLICT (player_name, opponent, prop_type) DO UPDATE SET
    games_played = EXCLUDED.games_played, 
    avg_stat = EXCLUDED.avg_stat,
    max_stat = EXCLUDED.max_stat, 
    min_stat = EXCLUDED.min_stat, 
    last_updated = now();
  
  GET DIAGNOSTICS v_prop_types_synced = ROW_COUNT;
  v_total_records := v_total_records + v_prop_types_synced;

  -- Count unique players synced
  SELECT COUNT(DISTINCT player_name) INTO v_players_synced FROM matchup_history;
  
  RETURN QUERY SELECT v_players_synced, 4, v_total_records;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;