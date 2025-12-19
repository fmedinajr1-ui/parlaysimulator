-- NFL Team Defense Stats Table
CREATE TABLE nfl_team_defense_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_abbrev TEXT NOT NULL UNIQUE,
  team_name TEXT NOT NULL,
  
  -- Rushing Defense
  rush_yards_allowed_per_game NUMERIC DEFAULT 0,
  rush_tds_allowed INTEGER DEFAULT 0,
  rush_attempts_against INTEGER DEFAULT 0,
  rush_yards_per_attempt_allowed NUMERIC DEFAULT 0,
  rush_defense_rank INTEGER,
  
  -- Passing Defense
  pass_yards_allowed_per_game NUMERIC DEFAULT 0,
  pass_tds_allowed INTEGER DEFAULT 0,
  completions_allowed INTEGER DEFAULT 0,
  interceptions_forced INTEGER DEFAULT 0,
  pass_defense_rank INTEGER,
  
  -- Overall
  total_yards_allowed_per_game NUMERIC DEFAULT 0,
  points_allowed_per_game NUMERIC DEFAULT 0,
  overall_defense_rank INTEGER,
  
  -- Positional Ranks
  vs_qb_rank INTEGER,
  vs_rb_rank INTEGER,
  vs_wr_rank INTEGER,
  vs_te_rank INTEGER,
  
  games_played INTEGER DEFAULT 0,
  season TEXT DEFAULT '2024',
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- NHL Team Pace Stats Table
CREATE TABLE nhl_team_pace_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_abbrev TEXT NOT NULL UNIQUE,
  team_name TEXT NOT NULL,
  
  -- Shots Metrics
  shots_for_per_game NUMERIC DEFAULT 0,
  shots_against_per_game NUMERIC DEFAULT 0,
  shot_differential NUMERIC DEFAULT 0,
  
  -- Rankings
  shot_suppression_rank INTEGER,
  shot_generation_rank INTEGER,
  
  -- Goals
  goals_for_per_game NUMERIC DEFAULT 0,
  goals_against_per_game NUMERIC DEFAULT 0,
  
  -- Game Context
  games_played INTEGER DEFAULT 0,
  wins INTEGER DEFAULT 0,
  losses INTEGER DEFAULT 0,
  ot_losses INTEGER DEFAULT 0,
  
  season TEXT DEFAULT '20242025',
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- First Scorer Props Table
CREATE TABLE first_scorer_props (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Game info
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  home_team TEXT,
  away_team TEXT,
  game_time TIMESTAMPTZ,
  
  -- Prop details
  prop_type TEXT NOT NULL,
  selection TEXT NOT NULL,
  
  -- Odds
  odds NUMERIC,
  implied_probability NUMERIC,
  
  -- AI Analysis
  ai_probability NUMERIC,
  edge NUMERIC,
  confidence_score NUMERIC,
  recommendation TEXT,
  analysis_factors JSONB DEFAULT '{}'::jsonb,
  
  -- Outcome tracking
  outcome TEXT DEFAULT 'pending',
  actual_first_scorer TEXT,
  verified_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE nfl_team_defense_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE nhl_team_pace_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE first_scorer_props ENABLE ROW LEVEL SECURITY;

-- Public read policies
CREATE POLICY "Anyone can view NFL defense stats" ON nfl_team_defense_stats FOR SELECT USING (true);
CREATE POLICY "Anyone can view NHL pace stats" ON nhl_team_pace_stats FOR SELECT USING (true);
CREATE POLICY "Anyone can view first scorer props" ON first_scorer_props FOR SELECT USING (true);

-- Create indexes
CREATE INDEX idx_nfl_defense_team ON nfl_team_defense_stats(team_abbrev);
CREATE INDEX idx_nhl_pace_team ON nhl_team_pace_stats(team_abbrev);
CREATE INDEX idx_first_scorer_game ON first_scorer_props(game_id);
CREATE INDEX idx_first_scorer_sport ON first_scorer_props(sport);
CREATE INDEX idx_first_scorer_active ON first_scorer_props(is_active) WHERE is_active = true;