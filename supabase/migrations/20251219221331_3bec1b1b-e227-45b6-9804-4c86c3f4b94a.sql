-- Create unified injury reports table for all sports
CREATE TABLE IF NOT EXISTS public.injury_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  team_name TEXT NOT NULL,
  player_name TEXT NOT NULL,
  position TEXT,
  status TEXT NOT NULL, -- OUT, DOUBTFUL, QUESTIONABLE, PROBABLE, DAY_TO_DAY
  injury_type TEXT,
  injury_detail TEXT,
  impact_score NUMERIC DEFAULT 0, -- 0-100 impact on team
  is_star_player BOOLEAN DEFAULT false,
  game_date DATE,
  event_id TEXT,
  source TEXT DEFAULT 'espn',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create index for fast lookups
CREATE INDEX idx_injury_reports_team_date ON injury_reports(team_name, game_date);
CREATE INDEX idx_injury_reports_sport ON injury_reports(sport);

-- Create god_mode_weights table for tunable weights
CREATE TABLE IF NOT EXISTS public.god_mode_weights (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  weight_key TEXT NOT NULL,
  weight_value NUMERIC NOT NULL DEFAULT 0.15,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(sport, weight_key)
);

-- Seed default weights for all sports
INSERT INTO god_mode_weights (sport, weight_key, weight_value, description) VALUES
  -- NBA weights
  ('NBA', 'sharp_pct', 0.20, 'Sharp money percentage weight'),
  ('NBA', 'chess_ev', 0.15, 'CHESS EV calculation weight'),
  ('NBA', 'upset_value', 0.15, 'Upset value score weight'),
  ('NBA', 'record_diff', 0.15, 'Record differential weight'),
  ('NBA', 'home_court', 0.10, 'Home court advantage weight'),
  ('NBA', 'historical_day', 0.10, 'Historical day of week weight'),
  ('NBA', 'monte_carlo', 0.15, 'Monte Carlo simulation weight'),
  -- NFL weights
  ('NFL', 'sharp_pct', 0.25, 'Sharp money percentage weight'),
  ('NFL', 'chess_ev', 0.10, 'CHESS EV calculation weight'),
  ('NFL', 'upset_value', 0.20, 'Upset value score weight'),
  ('NFL', 'record_diff', 0.15, 'Record differential weight'),
  ('NFL', 'home_court', 0.10, 'Home field advantage weight'),
  ('NFL', 'historical_day', 0.05, 'Historical day of week weight'),
  ('NFL', 'monte_carlo', 0.15, 'Monte Carlo simulation weight'),
  -- NHL weights
  ('NHL', 'sharp_pct', 0.20, 'Sharp money percentage weight'),
  ('NHL', 'chess_ev', 0.10, 'CHESS EV calculation weight'),
  ('NHL', 'upset_value', 0.20, 'Upset value score weight'),
  ('NHL', 'record_diff', 0.15, 'Record differential weight'),
  ('NHL', 'home_court', 0.15, 'Home ice advantage weight'),
  ('NHL', 'historical_day', 0.05, 'Historical day of week weight'),
  ('NHL', 'monte_carlo', 0.15, 'Monte Carlo simulation weight'),
  -- Default weights for other sports
  ('DEFAULT', 'sharp_pct', 0.20, 'Sharp money percentage weight'),
  ('DEFAULT', 'chess_ev', 0.10, 'CHESS EV calculation weight'),
  ('DEFAULT', 'upset_value', 0.15, 'Upset value score weight'),
  ('DEFAULT', 'record_diff', 0.15, 'Record differential weight'),
  ('DEFAULT', 'home_court', 0.10, 'Home court advantage weight'),
  ('DEFAULT', 'historical_day', 0.10, 'Historical day of week weight'),
  ('DEFAULT', 'monte_carlo', 0.20, 'Monte Carlo simulation weight')
ON CONFLICT (sport, weight_key) DO UPDATE SET
  weight_value = EXCLUDED.weight_value,
  description = EXCLUDED.description;

-- Add time_decayed_accuracy function
CREATE OR REPLACE FUNCTION public.get_time_decayed_accuracy(
  p_signal_type TEXT,
  p_decay_days INTEGER DEFAULT 90
)
RETURNS TABLE(
  decayed_accuracy NUMERIC,
  recent_accuracy NUMERIC,
  total_sample_size INTEGER,
  recent_sample_size INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  decay_factor NUMERIC;
BEGIN
  RETURN QUERY
  WITH weighted_outcomes AS (
    SELECT 
      outcome_correct,
      created_at,
      -- Exponential decay: recent outcomes weighted more heavily
      EXP(-EXTRACT(EPOCH FROM (NOW() - created_at)) / (p_decay_days * 86400)) as weight
    FROM best_bets_log
    WHERE signal_type = p_signal_type
      AND outcome IS NOT NULL
  )
  SELECT 
    -- Weighted accuracy (time-decayed)
    ROUND(
      SUM(CASE WHEN outcome_correct THEN weight ELSE 0 END) / NULLIF(SUM(weight), 0) * 100,
      2
    )::NUMERIC as decayed_accuracy,
    -- Recent 30-day accuracy
    ROUND(
      COUNT(*) FILTER (WHERE outcome_correct AND created_at >= NOW() - INTERVAL '30 days')::NUMERIC /
      NULLIF(COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days'), 0) * 100,
      2
    )::NUMERIC as recent_accuracy,
    COUNT(*)::INTEGER as total_sample_size,
    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::INTEGER as recent_sample_size
  FROM weighted_outcomes;
END;
$$;

-- Enable RLS
ALTER TABLE injury_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE god_mode_weights ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Injury reports are publicly readable" ON injury_reports FOR SELECT USING (true);
CREATE POLICY "God mode weights are publicly readable" ON god_mode_weights FOR SELECT USING (true);

-- Admin write access
CREATE POLICY "Admins can manage injury reports" ON injury_reports FOR ALL 
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage god mode weights" ON god_mode_weights FOR ALL 
  USING (public.has_role(auth.uid(), 'admin'));