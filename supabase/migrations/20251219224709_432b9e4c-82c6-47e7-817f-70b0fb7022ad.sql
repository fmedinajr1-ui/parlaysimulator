-- Add sport-specific sharp engine configuration table
CREATE TABLE IF NOT EXISTS public.sharp_engine_sport_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  config_key TEXT NOT NULL,
  config_value NUMERIC NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(sport, config_key)
);

-- Add new diagnostic columns to line_movements if they don't exist
ALTER TABLE public.line_movements 
ADD COLUMN IF NOT EXISTS consensus_ratio NUMERIC,
ADD COLUMN IF NOT EXISTS price_direction TEXT,
ADD COLUMN IF NOT EXISTS opening_side TEXT,
ADD COLUMN IF NOT EXISTS movement_bucket TEXT,
ADD COLUMN IF NOT EXISTS sport_adjusted BOOLEAN DEFAULT false;

-- Create signal accuracy tracking table
CREATE TABLE IF NOT EXISTS public.sharp_signal_accuracy (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  signal_name TEXT NOT NULL,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('sharp', 'trap')),
  sport TEXT,
  total_occurrences INTEGER DEFAULT 0,
  correct_when_present INTEGER DEFAULT 0,
  accuracy_rate NUMERIC DEFAULT 0,
  avg_ses_when_present NUMERIC DEFAULT 0,
  suggested_weight NUMERIC,
  last_calibrated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(signal_name, sport)
);

-- Enable RLS on new tables
ALTER TABLE public.sharp_engine_sport_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sharp_signal_accuracy ENABLE ROW LEVEL SECURITY;

-- Create policies for reading (public read for both)
CREATE POLICY "Anyone can read sport config" ON public.sharp_engine_sport_config
FOR SELECT USING (true);

CREATE POLICY "Anyone can read signal accuracy" ON public.sharp_signal_accuracy
FOR SELECT USING (true);

-- Create policies for admin write access
CREATE POLICY "Admins can manage sport config" ON public.sharp_engine_sport_config
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

CREATE POLICY "Admins can manage signal accuracy" ON public.sharp_signal_accuracy
FOR ALL USING (
  EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
);

-- Insert default sport-specific configurations based on outcome data analysis
-- NFL: Fade performs well (57.1%), lower SES better
INSERT INTO public.sharp_engine_sport_config (sport, config_key, config_value, description) VALUES
('americanfootball_nfl', 'MW_MINIMAL', 1.0, 'Minimal movement weight - inverted: best performer'),
('americanfootball_nfl', 'MW_SMALL', 0.8, 'Small movement weight'),
('americanfootball_nfl', 'MW_MODERATE', 0.5, 'Moderate movement weight'),
('americanfootball_nfl', 'MW_LARGE', 0.3, 'Large movement weight'),
('americanfootball_nfl', 'MW_EXTREME', 0.1, 'Extreme movement weight - inverted: worst performer'),
('americanfootball_nfl', 'PICK_SES_THRESHOLD', -20, 'Lower threshold for NFL picks'),
('americanfootball_nfl', 'FADE_SES_THRESHOLD', 20, 'Inverted fade threshold for NFL'),
('americanfootball_nfl', 'SIGNAL_ISOLATED_SHARP', 25, 'Isolated moves are sharp in NFL'),
('americanfootball_nfl', 'TRAP_CONSENSUS_HIGH', 25, 'High consensus is trap in NFL'),
('americanfootball_nfl', 'TRAP_STEAM_MOVE', 20, 'Steam moves are traps in NFL')
ON CONFLICT (sport, config_key) DO UPDATE SET config_value = EXCLUDED.config_value;

-- NBA: Similar inversion needed
INSERT INTO public.sharp_engine_sport_config (sport, config_key, config_value, description) VALUES
('basketball_nba', 'MW_MINIMAL', 1.0, 'Minimal movement weight'),
('basketball_nba', 'MW_SMALL', 0.8, 'Small movement weight'),
('basketball_nba', 'MW_MODERATE', 0.5, 'Moderate movement weight'),
('basketball_nba', 'MW_LARGE', 0.3, 'Large movement weight'),
('basketball_nba', 'MW_EXTREME', 0.1, 'Extreme movement weight'),
('basketball_nba', 'PICK_SES_THRESHOLD', -15, 'Lower threshold for NBA picks'),
('basketball_nba', 'FADE_SES_THRESHOLD', 15, 'Inverted fade threshold for NBA'),
('basketball_nba', 'SIGNAL_ISOLATED_SHARP', 20, 'Isolated moves are sharp in NBA'),
('basketball_nba', 'TRAP_CONSENSUS_HIGH', 20, 'High consensus is trap in NBA'),
('basketball_nba', 'TW_EARLY', 0.8, 'Early moves more valuable in NBA (rest info)')
ON CONFLICT (sport, config_key) DO UPDATE SET config_value = EXCLUDED.config_value;

-- NCAAB: Fade underperforms, keep more traditional
INSERT INTO public.sharp_engine_sport_config (sport, config_key, config_value, description) VALUES
('basketball_ncaab', 'MW_MINIMAL', 0.8, 'Minimal movement weight'),
('basketball_ncaab', 'MW_SMALL', 0.9, 'Small movement weight'),
('basketball_ncaab', 'MW_MODERATE', 0.7, 'Moderate movement weight'),
('basketball_ncaab', 'MW_LARGE', 0.4, 'Large movement weight'),
('basketball_ncaab', 'MW_EXTREME', 0.2, 'Extreme movement weight'),
('basketball_ncaab', 'PICK_SES_THRESHOLD', 15, 'Standard threshold for NCAAB'),
('basketball_ncaab', 'FADE_SES_THRESHOLD', -15, 'Standard fade for NCAAB'),
('basketball_ncaab', 'TW_EARLY', 1.0, 'Early action more reliable in college')
ON CONFLICT (sport, config_key) DO UPDATE SET config_value = EXCLUDED.config_value;

-- NHL: Add sport-specific config
INSERT INTO public.sharp_engine_sport_config (sport, config_key, config_value, description) VALUES
('icehockey_nhl', 'MW_MINIMAL', 0.9, 'Minimal movement weight'),
('icehockey_nhl', 'MW_SMALL', 0.85, 'Small movement weight'),
('icehockey_nhl', 'MW_MODERATE', 0.6, 'Moderate movement weight'),
('icehockey_nhl', 'MW_LARGE', 0.35, 'Large movement weight'),
('icehockey_nhl', 'MW_EXTREME', 0.15, 'Extreme movement weight'),
('icehockey_nhl', 'SIGNAL_ISOLATED_SHARP', 22, 'Isolated moves are sharp in NHL'),
('icehockey_nhl', 'TRAP_CONSENSUS_HIGH', 22, 'High consensus is trap in NHL')
ON CONFLICT (sport, config_key) DO UPDATE SET config_value = EXCLUDED.config_value;

-- Create function to get calibrated signal weights
CREATE OR REPLACE FUNCTION public.get_sharp_signal_accuracy_summary()
RETURNS TABLE (
  signal_name TEXT,
  signal_type TEXT,
  total_occurrences INTEGER,
  correct_when_present INTEGER,
  accuracy_rate NUMERIC,
  suggested_weight NUMERIC,
  performance_rating TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ssa.signal_name,
    ssa.signal_type,
    ssa.total_occurrences,
    ssa.correct_when_present,
    ssa.accuracy_rate,
    ssa.suggested_weight,
    CASE 
      WHEN ssa.accuracy_rate >= 60 THEN 'excellent'
      WHEN ssa.accuracy_rate >= 50 THEN 'good'
      WHEN ssa.accuracy_rate >= 40 THEN 'fair'
      ELSE 'poor'
    END as performance_rating
  FROM sharp_signal_accuracy ssa
  WHERE ssa.total_occurrences >= 10
  ORDER BY ssa.accuracy_rate DESC;
END;
$$;

-- Create trigger for updated_at on new tables
CREATE TRIGGER update_sharp_engine_sport_config_updated_at
BEFORE UPDATE ON public.sharp_engine_sport_config
FOR EACH ROW
EXECUTE FUNCTION public.update_team_aliases_updated_at();

CREATE TRIGGER update_sharp_signal_accuracy_updated_at
BEFORE UPDATE ON public.sharp_signal_accuracy
FOR EACH ROW
EXECUTE FUNCTION public.update_team_aliases_updated_at();