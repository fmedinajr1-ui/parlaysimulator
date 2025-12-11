-- Add unique constraint for upsert functionality
ALTER TABLE public.nhl_player_game_logs 
ADD CONSTRAINT nhl_player_game_logs_player_date_unique 
UNIQUE (player_name, game_date);