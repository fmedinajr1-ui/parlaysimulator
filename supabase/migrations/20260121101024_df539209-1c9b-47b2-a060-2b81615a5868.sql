-- Create a view for unique players with game counts
-- This eliminates the need for pagination in edge functions

CREATE OR REPLACE VIEW v_player_game_summary AS
SELECT 
  player_name,
  COUNT(*) as games_played,
  MIN(game_date) as first_game_date,
  MAX(game_date) as last_game_date,
  COUNT(*) FILTER (WHERE is_home = true) as home_games,
  COUNT(*) FILTER (WHERE is_home = false) as away_games
FROM nba_player_game_logs
GROUP BY player_name
ORDER BY player_name;