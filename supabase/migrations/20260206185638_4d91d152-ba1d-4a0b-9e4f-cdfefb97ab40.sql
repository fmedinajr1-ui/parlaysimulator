-- Player Behavior Profiles: Stores learned patterns per player
-- Combines historical data (game logs, PBP, zone stats) with optional film-derived insights

CREATE TABLE public.player_behavior_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  team TEXT,
  
  -- Shooting patterns (from game logs + zone stats)
  three_pt_peak_quarters JSONB,  -- {"q1": 22, "q2": 18, "q3": 28, "q4": 32} (percentages)
  scoring_zone_preferences JSONB, -- {"restricted_area": 35, "corner_3": 22} (percentages)
  clutch_performance_vs_average NUMERIC, -- +/- vs regular production in Q4 <5min
  
  -- Rotation patterns (from PBP substitution data)
  avg_first_rest_time TEXT,  -- "Q1 5:30"
  avg_second_stint_start TEXT,
  avg_minutes_per_quarter JSONB, -- {"q1": 10.2, "q2": 9.8, "q3": 11.1, "q4": 10.5}
  blowout_minutes_reduction NUMERIC, -- e.g., 8.5 (minutes less in blowouts)
  
  -- Matchup patterns (from historical logs)
  best_matchups JSONB,  -- [{"opponent": "LAL", "stat": "points", "avg_vs": 28.5, "games": 5}]
  worst_matchups JSONB, -- [{"opponent": "BOS", "stat": "points", "avg_vs": 18.2, "games": 4}]
  
  -- Film-derived insights (when uploaded)
  fatigue_tendency TEXT,  -- "Shows fatigue in Q3 after high-usage Q1"
  body_language_notes TEXT,
  film_sample_count INTEGER DEFAULT 0,
  
  -- Quarter-specific performance
  quarter_production JSONB, -- {"q1": {"pts": 7.2, "reb": 1.8}, "q2": {...}, ...}
  
  -- Metadata
  games_analyzed INTEGER DEFAULT 0,
  last_updated TIMESTAMPTZ DEFAULT now(),
  profile_confidence NUMERIC DEFAULT 0, -- 0-100 based on sample size
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  UNIQUE(player_name, team)
);

-- Enable RLS
ALTER TABLE public.player_behavior_profiles ENABLE ROW LEVEL SECURITY;

-- Public read access (profiles are not user-specific)
CREATE POLICY "Player profiles are publicly readable" 
ON public.player_behavior_profiles 
FOR SELECT 
USING (true);

-- Service role can insert/update (edge functions)
CREATE POLICY "Service role can manage profiles" 
ON public.player_behavior_profiles 
FOR ALL
USING (true)
WITH CHECK (true);

-- Indexes for common queries
CREATE INDEX idx_player_profiles_name ON public.player_behavior_profiles(player_name);
CREATE INDEX idx_player_profiles_team ON public.player_behavior_profiles(team);
CREATE INDEX idx_player_profiles_confidence ON public.player_behavior_profiles(profile_confidence DESC);
CREATE INDEX idx_player_profiles_updated ON public.player_behavior_profiles(last_updated DESC);

-- Add comment for documentation
COMMENT ON TABLE public.player_behavior_profiles IS 'Stores learned behavioral patterns per player from game logs, PBP data, zone stats, and optional film analysis';
