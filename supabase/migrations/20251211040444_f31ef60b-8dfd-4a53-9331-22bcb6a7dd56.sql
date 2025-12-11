-- Create NHL player game logs table for storing player stats
CREATE TABLE IF NOT EXISTS public.nhl_player_game_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  game_date DATE NOT NULL,
  opponent TEXT NOT NULL,
  is_home BOOLEAN DEFAULT NULL,
  minutes_played INTEGER DEFAULT NULL,
  goals INTEGER DEFAULT NULL,
  assists INTEGER DEFAULT NULL,
  points INTEGER DEFAULT NULL,
  shots_on_goal INTEGER DEFAULT NULL,
  blocked_shots INTEGER DEFAULT NULL,
  power_play_points INTEGER DEFAULT NULL,
  plus_minus INTEGER DEFAULT NULL,
  penalty_minutes INTEGER DEFAULT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_nhl_player_game_logs_player ON public.nhl_player_game_logs(player_name);
CREATE INDEX IF NOT EXISTS idx_nhl_player_game_logs_date ON public.nhl_player_game_logs(game_date DESC);
CREATE INDEX IF NOT EXISTS idx_nhl_player_game_logs_opponent ON public.nhl_player_game_logs(opponent);

-- Enable RLS
ALTER TABLE public.nhl_player_game_logs ENABLE ROW LEVEL SECURITY;

-- Allow public read access (game stats are public data)
CREATE POLICY "NHL player game logs are publicly readable" 
  ON public.nhl_player_game_logs 
  FOR SELECT 
  USING (true);