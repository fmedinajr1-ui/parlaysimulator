-- Create player_season_stats table for season-long historical data
CREATE TABLE public.player_season_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  team_name TEXT,
  sport TEXT NOT NULL DEFAULT 'basketball_nba',
  season TEXT NOT NULL DEFAULT '2024-25',
  
  -- Game counts
  games_played INTEGER NOT NULL DEFAULT 0,
  avg_minutes NUMERIC NOT NULL DEFAULT 0,
  
  -- Season averages
  avg_points NUMERIC NOT NULL DEFAULT 0,
  avg_rebounds NUMERIC NOT NULL DEFAULT 0,
  avg_assists NUMERIC NOT NULL DEFAULT 0,
  avg_threes NUMERIC NOT NULL DEFAULT 0,
  avg_blocks NUMERIC NOT NULL DEFAULT 0,
  avg_steals NUMERIC NOT NULL DEFAULT 0,
  
  -- Home/Away splits
  home_games INTEGER NOT NULL DEFAULT 0,
  home_avg_points NUMERIC NOT NULL DEFAULT 0,
  home_avg_rebounds NUMERIC NOT NULL DEFAULT 0,
  home_avg_assists NUMERIC NOT NULL DEFAULT 0,
  home_avg_threes NUMERIC NOT NULL DEFAULT 0,
  
  away_games INTEGER NOT NULL DEFAULT 0,
  away_avg_points NUMERIC NOT NULL DEFAULT 0,
  away_avg_rebounds NUMERIC NOT NULL DEFAULT 0,
  away_avg_assists NUMERIC NOT NULL DEFAULT 0,
  away_avg_threes NUMERIC NOT NULL DEFAULT 0,
  
  -- Consistency metrics (standard deviation)
  points_std_dev NUMERIC NOT NULL DEFAULT 0,
  rebounds_std_dev NUMERIC NOT NULL DEFAULT 0,
  assists_std_dev NUMERIC NOT NULL DEFAULT 0,
  threes_std_dev NUMERIC NOT NULL DEFAULT 0,
  
  -- Trend analysis (last 10 games vs season)
  last_10_avg_points NUMERIC NOT NULL DEFAULT 0,
  last_10_avg_rebounds NUMERIC NOT NULL DEFAULT 0,
  last_10_avg_assists NUMERIC NOT NULL DEFAULT 0,
  last_10_avg_threes NUMERIC NOT NULL DEFAULT 0,
  
  -- Rest day splits
  b2b_games INTEGER NOT NULL DEFAULT 0,
  b2b_avg_points NUMERIC NOT NULL DEFAULT 0,
  rest_games INTEGER NOT NULL DEFAULT 0,
  rest_avg_points NUMERIC NOT NULL DEFAULT 0,
  
  -- Calculated scores
  consistency_score NUMERIC NOT NULL DEFAULT 50,
  trend_direction TEXT NOT NULL DEFAULT 'stable',
  
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(player_name, sport, season)
);

-- Add new intelligence columns to player_prop_hitrates
ALTER TABLE public.player_prop_hitrates 
ADD COLUMN IF NOT EXISTS season_avg NUMERIC,
ADD COLUMN IF NOT EXISTS season_games_played INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS line_vs_season_pct NUMERIC,
ADD COLUMN IF NOT EXISTS line_value_score NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS line_value_label TEXT DEFAULT 'neutral',
ADD COLUMN IF NOT EXISTS home_away_adjustment NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS opponent_defense_rank INTEGER,
ADD COLUMN IF NOT EXISTS consistency_score NUMERIC DEFAULT 50,
ADD COLUMN IF NOT EXISTS rest_days_factor NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS fatigue_impact NUMERIC DEFAULT 0,
ADD COLUMN IF NOT EXISTS trend_direction TEXT DEFAULT 'stable',
ADD COLUMN IF NOT EXISTS season_trend_pct NUMERIC DEFAULT 0;

-- Enable RLS
ALTER TABLE public.player_season_stats ENABLE ROW LEVEL SECURITY;

-- Create read policy
CREATE POLICY "Anyone can view player season stats" 
ON public.player_season_stats 
FOR SELECT 
USING (true);

-- Create index for faster lookups
CREATE INDEX idx_player_season_stats_player ON public.player_season_stats(player_name, sport, season);
CREATE INDEX idx_player_season_stats_team ON public.player_season_stats(team_name);

-- Create index on hitrates for new columns
CREATE INDEX IF NOT EXISTS idx_hitrates_line_value ON public.player_prop_hitrates(line_value_score DESC);
CREATE INDEX IF NOT EXISTS idx_hitrates_consistency ON public.player_prop_hitrates(consistency_score DESC);