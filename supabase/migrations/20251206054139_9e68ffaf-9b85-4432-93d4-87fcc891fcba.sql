-- Add PVS scoring columns to unified_props table
ALTER TABLE public.unified_props 
ADD COLUMN IF NOT EXISTS pvs_confidence_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS pvs_accuracy_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS pvs_value_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS pvs_matchup_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS pvs_pace_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS pvs_minutes_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS pvs_sharp_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS pvs_injury_tax numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS pvs_final_score numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS pvs_tier text DEFAULT 'uncategorized',
ADD COLUMN IF NOT EXISTS true_line numeric,
ADD COLUMN IF NOT EXISTS true_line_diff numeric DEFAULT 0;

-- Create opponent defense stats table for matchup scoring
CREATE TABLE IF NOT EXISTS public.nba_opponent_defense_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name text NOT NULL,
  stat_category text NOT NULL,
  defense_rank integer NOT NULL DEFAULT 15,
  defense_rating numeric NOT NULL DEFAULT 100,
  points_allowed_avg numeric DEFAULT 0,
  rebounds_allowed_avg numeric DEFAULT 0,
  assists_allowed_avg numeric DEFAULT 0,
  threes_allowed_avg numeric DEFAULT 0,
  blocks_allowed_avg numeric DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(team_name, stat_category)
);

-- Create player game logs for accuracy calculation
CREATE TABLE IF NOT EXISTS public.nba_player_game_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name text NOT NULL,
  game_date date NOT NULL,
  opponent text NOT NULL,
  minutes_played numeric DEFAULT 0,
  points numeric DEFAULT 0,
  rebounds numeric DEFAULT 0,
  assists numeric DEFAULT 0,
  threes_made numeric DEFAULT 0,
  blocks numeric DEFAULT 0,
  steals numeric DEFAULT 0,
  turnovers numeric DEFAULT 0,
  is_home boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(player_name, game_date)
);

-- Create team pace projections
CREATE TABLE IF NOT EXISTS public.nba_team_pace_projections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name text NOT NULL UNIQUE,
  pace_rating numeric NOT NULL DEFAULT 100,
  pace_rank integer NOT NULL DEFAULT 15,
  possessions_per_game numeric DEFAULT 100,
  tempo_factor numeric DEFAULT 1.0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create injury volatility tracking
CREATE TABLE IF NOT EXISTS public.nba_injury_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name text NOT NULL,
  player_name text NOT NULL,
  status text NOT NULL DEFAULT 'questionable',
  injury_type text,
  impact_level text DEFAULT 'low',
  affects_rotation boolean DEFAULT false,
  game_date date NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Create PVS parlays table for auto-generated parlays
CREATE TABLE IF NOT EXISTS public.pvs_parlays (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parlay_type text NOT NULL DEFAULT 'safe_2leg',
  legs jsonb NOT NULL DEFAULT '[]'::jsonb,
  combined_pvs_score numeric DEFAULT 0,
  combined_probability numeric DEFAULT 0,
  total_odds numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE public.nba_opponent_defense_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_player_game_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_team_pace_projections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nba_injury_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pvs_parlays ENABLE ROW LEVEL SECURITY;

-- Create read policies for all users
CREATE POLICY "Anyone can view opponent defense stats" ON public.nba_opponent_defense_stats FOR SELECT USING (true);
CREATE POLICY "Anyone can view player game logs" ON public.nba_player_game_logs FOR SELECT USING (true);
CREATE POLICY "Anyone can view team pace projections" ON public.nba_team_pace_projections FOR SELECT USING (true);
CREATE POLICY "Anyone can view injury reports" ON public.nba_injury_reports FOR SELECT USING (true);
CREATE POLICY "Anyone can view PVS parlays" ON public.pvs_parlays FOR SELECT USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_unified_props_pvs_tier ON public.unified_props(pvs_tier);
CREATE INDEX IF NOT EXISTS idx_unified_props_pvs_final_score ON public.unified_props(pvs_final_score DESC);
CREATE INDEX IF NOT EXISTS idx_nba_player_game_logs_player ON public.nba_player_game_logs(player_name, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_nba_opponent_defense_stats_team ON public.nba_opponent_defense_stats(team_name);
CREATE INDEX IF NOT EXISTS idx_nba_injury_reports_team_date ON public.nba_injury_reports(team_name, game_date);