-- Add unique constraint on nfl_player_game_logs for upsert support
ALTER TABLE public.nfl_player_game_logs 
ADD CONSTRAINT nfl_player_game_logs_player_date_unique 
UNIQUE (player_name, game_date);