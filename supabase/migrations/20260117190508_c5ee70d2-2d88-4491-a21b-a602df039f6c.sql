-- Clear incorrect outcomes for picks with future games (games that haven't started yet)
UPDATE nba_risk_engine_picks
SET outcome = NULL, actual_value = NULL
WHERE game_date = '2026-01-17'
  AND outcome IS NOT NULL
  AND player_name IN (
    SELECT DISTINCT p.player_name 
    FROM unified_props p 
    WHERE p.commence_time > NOW()
  );