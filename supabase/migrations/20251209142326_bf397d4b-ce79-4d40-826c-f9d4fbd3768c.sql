-- Create team_season_standings table for NBA/NFL historical records
CREATE TABLE public.team_season_standings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport TEXT NOT NULL,
  team_name TEXT NOT NULL,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  ties INTEGER DEFAULT 0,
  win_pct NUMERIC DEFAULT 0.5,
  home_record TEXT,
  away_record TEXT,
  last_10 TEXT,
  streak TEXT,
  conference TEXT,
  division TEXT,
  conference_rank INTEGER,
  division_rank INTEGER,
  points_for NUMERIC DEFAULT 0,
  points_against NUMERIC DEFAULT 0,
  point_differential NUMERIC DEFAULT 0,
  season TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(sport, team_name, season)
);

-- Create extreme_movement_alerts table for juiced line warnings
CREATE TABLE public.extreme_movement_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  description TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  opening_price NUMERIC,
  current_price NUMERIC,
  total_movement NUMERIC NOT NULL,
  movement_percentage NUMERIC,
  direction TEXT,
  alert_level TEXT NOT NULL,
  bookmaker TEXT,
  player_name TEXT,
  prop_type TEXT,
  reasons JSONB DEFAULT '[]'::jsonb,
  is_trap_indicator BOOLEAN DEFAULT false,
  commence_time TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.team_season_standings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.extreme_movement_alerts ENABLE ROW LEVEL SECURITY;

-- RLS policies for public read access
CREATE POLICY "Anyone can view team standings" ON public.team_season_standings
  FOR SELECT USING (true);

CREATE POLICY "Anyone can view movement alerts" ON public.extreme_movement_alerts
  FOR SELECT USING (true);

-- Create indexes for performance
CREATE INDEX idx_team_standings_sport_season ON public.team_season_standings(sport, season);
CREATE INDEX idx_team_standings_team ON public.team_season_standings(team_name);
CREATE INDEX idx_extreme_alerts_event ON public.extreme_movement_alerts(event_id);
CREATE INDEX idx_extreme_alerts_level ON public.extreme_movement_alerts(alert_level);
CREATE INDEX idx_extreme_alerts_created ON public.extreme_movement_alerts(created_at DESC);