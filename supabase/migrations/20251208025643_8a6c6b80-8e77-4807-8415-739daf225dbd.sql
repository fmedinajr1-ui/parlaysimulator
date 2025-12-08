
-- Create god_mode_upset_predictions table with real-time support
CREATE TABLE public.god_mode_upset_predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  underdog TEXT NOT NULL,
  underdog_odds NUMERIC NOT NULL,
  favorite TEXT NOT NULL,
  favorite_odds NUMERIC NOT NULL,
  commence_time TIMESTAMP WITH TIME ZONE NOT NULL,
  
  -- Core Scores (0-100)
  final_upset_score NUMERIC NOT NULL DEFAULT 0,
  upset_probability NUMERIC NOT NULL DEFAULT 0,
  
  -- Component Scores
  sharp_pct NUMERIC NOT NULL DEFAULT 0,
  chess_ev NUMERIC NOT NULL DEFAULT 0,
  upset_value_score NUMERIC NOT NULL DEFAULT 0,
  home_court_advantage NUMERIC NOT NULL DEFAULT 0,
  historical_day_boost NUMERIC NOT NULL DEFAULT 0,
  monte_carlo_boost NUMERIC NOT NULL DEFAULT 0,
  
  -- Chaos Mode
  chaos_percentage NUMERIC NOT NULL DEFAULT 0,
  chaos_mode_active BOOLEAN NOT NULL DEFAULT false,
  
  -- Classification
  confidence TEXT NOT NULL DEFAULT 'low',
  risk_level INTEGER NOT NULL DEFAULT 3,
  suggestion TEXT NOT NULL DEFAULT 'avoid',
  
  -- Signals
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  trap_on_favorite BOOLEAN NOT NULL DEFAULT false,
  
  -- AI Reasoning
  ai_reasoning TEXT,
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Parlay Impact
  parlay_impact JSONB NOT NULL DEFAULT '{"evImpact": 0, "riskReduction": 0, "synergyBoost": 0}'::jsonb,
  
  -- Real-time tracking
  is_live BOOLEAN NOT NULL DEFAULT false,
  last_odds_update TIMESTAMP WITH TIME ZONE DEFAULT now(),
  odds_change_direction TEXT DEFAULT 'stable',
  previous_odds NUMERIC,
  
  -- Outcome tracking
  game_completed BOOLEAN NOT NULL DEFAULT false,
  was_upset BOOLEAN,
  verified_at TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(event_id, underdog)
);

-- Create home_court_advantage_stats table
CREATE TABLE public.home_court_advantage_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name TEXT NOT NULL,
  sport TEXT NOT NULL,
  home_win_rate NUMERIC NOT NULL DEFAULT 0.5,
  home_cover_rate NUMERIC NOT NULL DEFAULT 0.5,
  home_over_rate NUMERIC NOT NULL DEFAULT 0.5,
  avg_home_margin NUMERIC NOT NULL DEFAULT 0,
  home_upset_rate NUMERIC NOT NULL DEFAULT 0,
  away_upset_rate NUMERIC NOT NULL DEFAULT 0,
  venue_name TEXT,
  sample_size INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(team_name, sport)
);

-- Create god_mode_accuracy_metrics table
CREATE TABLE public.god_mode_accuracy_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT,
  confidence_level TEXT NOT NULL,
  chaos_mode_active BOOLEAN NOT NULL DEFAULT false,
  total_predictions INTEGER NOT NULL DEFAULT 0,
  correct_predictions INTEGER NOT NULL DEFAULT 0,
  accuracy_rate NUMERIC NOT NULL DEFAULT 0,
  avg_upset_score NUMERIC NOT NULL DEFAULT 0,
  roi_percentage NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(sport, confidence_level, chaos_mode_active)
);

-- Enable RLS
ALTER TABLE public.god_mode_upset_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_court_advantage_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.god_mode_accuracy_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Public read access
CREATE POLICY "Anyone can view god mode predictions" 
  ON public.god_mode_upset_predictions FOR SELECT USING (true);

CREATE POLICY "Anyone can view home court stats" 
  ON public.home_court_advantage_stats FOR SELECT USING (true);

CREATE POLICY "Anyone can view god mode accuracy" 
  ON public.god_mode_accuracy_metrics FOR SELECT USING (true);

-- Enable realtime for god_mode_upset_predictions
ALTER PUBLICATION supabase_realtime ADD TABLE public.god_mode_upset_predictions;

-- Create updated_at trigger function if not exists
CREATE OR REPLACE FUNCTION public.update_god_mode_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add trigger for updated_at
CREATE TRIGGER update_god_mode_predictions_updated_at
  BEFORE UPDATE ON public.god_mode_upset_predictions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_god_mode_updated_at();

CREATE TRIGGER update_home_court_stats_updated_at
  BEFORE UPDATE ON public.home_court_advantage_stats
  FOR EACH ROW
  EXECUTE FUNCTION public.update_god_mode_updated_at();

-- Seed home court advantage data for NBA teams
INSERT INTO public.home_court_advantage_stats (team_name, sport, home_win_rate, home_cover_rate, home_upset_rate, away_upset_rate, avg_home_margin, sample_size) VALUES
('Los Angeles Lakers', 'basketball_nba', 0.62, 0.54, 0.18, 0.32, 4.2, 82),
('Boston Celtics', 'basketball_nba', 0.68, 0.58, 0.15, 0.28, 5.8, 82),
('Denver Nuggets', 'basketball_nba', 0.72, 0.61, 0.12, 0.25, 7.2, 82),
('Utah Jazz', 'basketball_nba', 0.65, 0.56, 0.16, 0.29, 5.5, 82),
('Phoenix Suns', 'basketball_nba', 0.61, 0.53, 0.19, 0.31, 3.8, 82),
('Golden State Warriors', 'basketball_nba', 0.64, 0.55, 0.17, 0.30, 4.8, 82),
('Milwaukee Bucks', 'basketball_nba', 0.66, 0.57, 0.16, 0.28, 5.2, 82),
('Miami Heat', 'basketball_nba', 0.63, 0.55, 0.18, 0.30, 4.5, 82),
('Philadelphia 76ers', 'basketball_nba', 0.61, 0.52, 0.19, 0.32, 3.9, 82),
('Cleveland Cavaliers', 'basketball_nba', 0.64, 0.54, 0.17, 0.29, 4.6, 82)
ON CONFLICT (team_name, sport) DO NOTHING;
