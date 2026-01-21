-- Team Defensive Ratings table - stores opponent strength for each stat category
CREATE TABLE IF NOT EXISTS public.team_defensive_ratings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name TEXT NOT NULL,
  team_abbrev TEXT,
  stat_type TEXT NOT NULL, -- points, rebounds, assists, threes, steals, blocks
  position_group TEXT, -- guards, forwards, centers, all
  defensive_rank INTEGER, -- 1-30 (1 = best defense)
  stat_allowed_per_game DECIMAL,
  games_sample INTEGER DEFAULT 10,
  season TEXT DEFAULT '2024-25',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(team_name, stat_type, position_group, season)
);

-- Game Environment table - stores Vegas lines and game context
CREATE TABLE IF NOT EXISTS public.game_environment (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id TEXT NOT NULL,
  game_date DATE NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_team_abbrev TEXT,
  away_team_abbrev TEXT,
  vegas_total DECIMAL, -- Over/under line
  vegas_spread DECIMAL, -- Negative = home favorite
  home_implied_total DECIMAL,
  away_implied_total DECIMAL,
  pace_rating TEXT DEFAULT 'MEDIUM', -- HIGH, MEDIUM, LOW
  blowout_probability DECIMAL DEFAULT 0.15,
  moneyline_home INTEGER,
  moneyline_away INTEGER,
  commence_time TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(game_id)
);

-- Matchup intelligence cache - stores analyzed matchup scores
CREATE TABLE IF NOT EXISTS public.matchup_intelligence (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  opponent_team TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  side TEXT NOT NULL, -- over/under
  line DECIMAL NOT NULL,
  game_date DATE NOT NULL,
  
  -- Matchup analysis results
  opponent_defensive_rank INTEGER,
  opponent_stat_allowed DECIMAL,
  matchup_score DECIMAL, -- -10 to +10
  vegas_total DECIMAL,
  vegas_spread DECIMAL,
  implied_team_total DECIMAL,
  blowout_risk DECIMAL,
  
  -- Flags and recommendations
  is_blocked BOOLEAN DEFAULT false,
  block_reason TEXT,
  risk_flags TEXT[], -- Array of risk flag codes
  confidence_adjustment DECIMAL DEFAULT 0,
  
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(player_name, prop_type, side, line, game_date)
);

-- Enable RLS
ALTER TABLE public.team_defensive_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.game_environment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matchup_intelligence ENABLE ROW LEVEL SECURITY;

-- Public read access for all tables
CREATE POLICY "Public read team_defensive_ratings" ON public.team_defensive_ratings FOR SELECT USING (true);
CREATE POLICY "Public read game_environment" ON public.game_environment FOR SELECT USING (true);
CREATE POLICY "Public read matchup_intelligence" ON public.matchup_intelligence FOR SELECT USING (true);

-- Service role write access
CREATE POLICY "Service write team_defensive_ratings" ON public.team_defensive_ratings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write game_environment" ON public.game_environment FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service write matchup_intelligence" ON public.matchup_intelligence FOR ALL USING (true) WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_team_defensive_ratings_team ON public.team_defensive_ratings(team_name);
CREATE INDEX IF NOT EXISTS idx_team_defensive_ratings_stat ON public.team_defensive_ratings(stat_type);
CREATE INDEX IF NOT EXISTS idx_game_environment_date ON public.game_environment(game_date);
CREATE INDEX IF NOT EXISTS idx_game_environment_teams ON public.game_environment(home_team, away_team);
CREATE INDEX IF NOT EXISTS idx_matchup_intelligence_player ON public.matchup_intelligence(player_name, game_date);
CREATE INDEX IF NOT EXISTS idx_matchup_intelligence_blocked ON public.matchup_intelligence(is_blocked) WHERE is_blocked = true;