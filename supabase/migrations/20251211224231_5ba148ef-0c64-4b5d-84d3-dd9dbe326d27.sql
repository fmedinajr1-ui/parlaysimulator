-- Create NFL player game logs table for hit rate analysis
CREATE TABLE public.nfl_player_game_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  game_date DATE NOT NULL,
  opponent TEXT NOT NULL,
  team TEXT,
  is_home BOOLEAN DEFAULT false,
  passing_yards NUMERIC DEFAULT 0,
  passing_tds NUMERIC DEFAULT 0,
  rushing_yards NUMERIC DEFAULT 0,
  rushing_tds NUMERIC DEFAULT 0,
  receptions NUMERIC DEFAULT 0,
  receiving_yards NUMERIC DEFAULT 0,
  receiving_tds NUMERIC DEFAULT 0,
  attempts NUMERIC DEFAULT 0,
  completions NUMERIC DEFAULT 0,
  interceptions NUMERIC DEFAULT 0,
  targets NUMERIC DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(player_name, game_date, opponent)
);

-- Enable RLS
ALTER TABLE public.nfl_player_game_logs ENABLE ROW LEVEL SECURITY;

-- Create read policy for anyone
CREATE POLICY "Anyone can view NFL player game logs"
ON public.nfl_player_game_logs
FOR SELECT
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_nfl_player_game_logs_player ON public.nfl_player_game_logs(player_name);
CREATE INDEX idx_nfl_player_game_logs_date ON public.nfl_player_game_logs(game_date DESC);

-- Create NFL player season stats table
CREATE TABLE public.nfl_player_season_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL UNIQUE,
  team TEXT,
  position TEXT,
  games_played INTEGER DEFAULT 0,
  passing_yards_avg NUMERIC DEFAULT 0,
  passing_yards_std NUMERIC DEFAULT 0,
  passing_tds_avg NUMERIC DEFAULT 0,
  rushing_yards_avg NUMERIC DEFAULT 0,
  rushing_yards_std NUMERIC DEFAULT 0,
  receptions_avg NUMERIC DEFAULT 0,
  receptions_std NUMERIC DEFAULT 0,
  receiving_yards_avg NUMERIC DEFAULT 0,
  receiving_yards_std NUMERIC DEFAULT 0,
  home_passing_yards_avg NUMERIC DEFAULT 0,
  away_passing_yards_avg NUMERIC DEFAULT 0,
  home_rushing_yards_avg NUMERIC DEFAULT 0,
  away_rushing_yards_avg NUMERIC DEFAULT 0,
  home_receptions_avg NUMERIC DEFAULT 0,
  away_receptions_avg NUMERIC DEFAULT 0,
  last10_passing_yards_avg NUMERIC DEFAULT 0,
  last10_rushing_yards_avg NUMERIC DEFAULT 0,
  last10_receptions_avg NUMERIC DEFAULT 0,
  consistency_score NUMERIC DEFAULT 50,
  trend_direction TEXT DEFAULT 'stable',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.nfl_player_season_stats ENABLE ROW LEVEL SECURITY;

-- Create read policy
CREATE POLICY "Anyone can view NFL season stats"
ON public.nfl_player_season_stats
FOR SELECT
USING (true);