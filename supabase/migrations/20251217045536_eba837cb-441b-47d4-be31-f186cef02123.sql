-- Create coach_profiles table
CREATE TABLE public.coach_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_name TEXT NOT NULL,
  team_name TEXT NOT NULL,
  sport TEXT NOT NULL DEFAULT 'basketball_nba',
  tenure_start_date DATE NOT NULL,
  tenure_end_date DATE,
  is_active BOOLEAN DEFAULT true,
  -- Derived tendencies
  pace_preference TEXT CHECK (pace_preference IN ('fast', 'moderate', 'slow')),
  rotation_depth INTEGER, -- avg players getting 15+ min
  star_usage_pct NUMERIC, -- top 3 player usage %
  b2b_rest_tendency TEXT CHECK (b2b_rest_tendency IN ('aggressive', 'moderate', 'cautious')),
  fourth_quarter_pattern TEXT CHECK (fourth_quarter_pattern IN ('ride_starters', 'balanced', 'bench_heavy')),
  blowout_minutes_reduction NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(coach_name, team_name, tenure_start_date)
);

-- Create index for quick lookups
CREATE INDEX idx_coach_team_active ON public.coach_profiles(team_name, sport, is_active);

-- Create coach_game_tendencies table
CREATE TABLE public.coach_game_tendencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID REFERENCES public.coach_profiles(id) ON DELETE CASCADE,
  game_date DATE NOT NULL,
  event_id TEXT,
  situation TEXT NOT NULL CHECK (situation IN ('b2b', 'b2b_road', 'fresh', '3_in_4', '4_in_6')),
  rotation_size INTEGER,
  star_minutes_pct NUMERIC,
  pace NUMERIC,
  total_possessions INTEGER,
  lineup_experiments INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(coach_id, game_date, event_id)
);

-- Create index for coach tendencies lookup
CREATE INDEX idx_coach_tendencies_lookup ON public.coach_game_tendencies(coach_id, situation, game_date DESC);

-- Enable RLS
ALTER TABLE public.coach_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coach_game_tendencies ENABLE ROW LEVEL SECURITY;

-- RLS Policies for coach_profiles
CREATE POLICY "Anyone can view coach profiles"
ON public.coach_profiles
FOR SELECT
USING (true);

CREATE POLICY "Service role can manage coach profiles"
ON public.coach_profiles
FOR ALL
USING (true)
WITH CHECK (true);

-- RLS Policies for coach_game_tendencies
CREATE POLICY "Anyone can view coach game tendencies"
ON public.coach_game_tendencies
FOR SELECT
USING (true);

CREATE POLICY "Service role can manage coach game tendencies"
ON public.coach_game_tendencies
FOR ALL
USING (true)
WITH CHECK (true);