-- Add unique constraint for upsert to work
ALTER TABLE nba_risk_engine_picks 
ADD CONSTRAINT nba_risk_engine_picks_player_date_prop_unique 
UNIQUE (player_name, game_date, prop_type);

-- Add spread column to upcoming_games_cache if not exists
ALTER TABLE upcoming_games_cache ADD COLUMN IF NOT EXISTS spread NUMERIC DEFAULT 0;