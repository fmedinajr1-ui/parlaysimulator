-- Create fatigue training data table for AI learning
CREATE TABLE IF NOT EXISTS public.fatigue_training_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'basketball_nba',
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  game_date DATE NOT NULL,
  home_fatigue_score NUMERIC NOT NULL,
  away_fatigue_score NUMERIC NOT NULL,
  fatigue_differential NUMERIC NOT NULL,
  recommended_side TEXT NOT NULL,
  recommended_angle TEXT,
  recommended_side_won BOOLEAN,
  game_result TEXT,
  actual_spread NUMERIC,
  actual_total NUMERIC,
  home_fatigue_factors JSONB,
  away_fatigue_factors JSONB,
  archived_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create sports team locations table
CREATE TABLE IF NOT EXISTS public.sports_team_locations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  team_name TEXT NOT NULL,
  team_abbreviation TEXT,
  city TEXT NOT NULL,
  state TEXT,
  latitude NUMERIC NOT NULL,
  longitude NUMERIC NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  altitude_ft INTEGER DEFAULT 0,
  arena_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(sport, team_name)
);

-- Create sports fatigue scores table (multi-sport version)
CREATE TABLE IF NOT EXISTS public.sports_fatigue_scores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'basketball_nba',
  team_name TEXT NOT NULL,
  fatigue_score NUMERIC NOT NULL DEFAULT 0,
  fatigue_category TEXT NOT NULL DEFAULT 'Fresh',
  is_back_to_back BOOLEAN DEFAULT false,
  is_three_in_four BOOLEAN DEFAULT false,
  travel_miles NUMERIC DEFAULT 0,
  timezone_changes INTEGER DEFAULT 0,
  altitude_factor NUMERIC DEFAULT 0,
  rest_days INTEGER DEFAULT 3,
  games_last_7_days INTEGER DEFAULT 0,
  games_last_14_days INTEGER DEFAULT 0,
  short_week BOOLEAN DEFAULT false,
  road_trip_games INTEGER DEFAULT 0,
  betting_adjustments JSONB,
  recommended_angle TEXT,
  game_date DATE NOT NULL DEFAULT CURRENT_DATE,
  commence_time TIMESTAMP WITH TIME ZONE,
  opponent_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(event_id, team_name, game_date)
);

-- Create sports fatigue edge tracking table
CREATE TABLE IF NOT EXISTS public.sports_fatigue_edge_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'basketball_nba',
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  game_date DATE NOT NULL,
  home_fatigue_score NUMERIC NOT NULL,
  away_fatigue_score NUMERIC NOT NULL,
  fatigue_differential NUMERIC NOT NULL,
  recommended_side TEXT NOT NULL,
  recommended_angle TEXT,
  recommended_side_won BOOLEAN,
  game_result TEXT,
  actual_spread NUMERIC,
  actual_total NUMERIC,
  spread_covered BOOLEAN,
  total_result TEXT,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(event_id, sport)
);

-- Enable RLS
ALTER TABLE public.fatigue_training_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sports_team_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sports_fatigue_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sports_fatigue_edge_tracking ENABLE ROW LEVEL SECURITY;

-- Create public read policies
CREATE POLICY "Anyone can read fatigue training data" ON public.fatigue_training_data FOR SELECT USING (true);
CREATE POLICY "Anyone can read sports team locations" ON public.sports_team_locations FOR SELECT USING (true);
CREATE POLICY "Anyone can read sports fatigue scores" ON public.sports_fatigue_scores FOR SELECT USING (true);
CREATE POLICY "Anyone can read sports fatigue edge tracking" ON public.sports_fatigue_edge_tracking FOR SELECT USING (true);

-- Create service role insert/update/delete policies
CREATE POLICY "Service role can manage fatigue training data" ON public.fatigue_training_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage sports team locations" ON public.sports_team_locations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage sports fatigue scores" ON public.sports_fatigue_scores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role can manage sports fatigue edge tracking" ON public.sports_fatigue_edge_tracking FOR ALL USING (true) WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX idx_fatigue_training_sport ON public.fatigue_training_data(sport);
CREATE INDEX idx_fatigue_training_date ON public.fatigue_training_data(game_date);
CREATE INDEX idx_sports_team_locations_sport ON public.sports_team_locations(sport);
CREATE INDEX idx_sports_fatigue_scores_sport ON public.sports_fatigue_scores(sport);
CREATE INDEX idx_sports_fatigue_scores_date ON public.sports_fatigue_scores(game_date);
CREATE INDEX idx_sports_fatigue_edge_sport ON public.sports_fatigue_edge_tracking(sport);
CREATE INDEX idx_sports_fatigue_edge_date ON public.sports_fatigue_edge_tracking(game_date);