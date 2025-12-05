
-- Create table to track fatigue edge betting outcomes
CREATE TABLE public.fatigue_edge_tracking (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id TEXT NOT NULL,
  game_date DATE NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  fatigue_differential INTEGER NOT NULL,
  recommended_side TEXT NOT NULL,
  recommended_angle TEXT,
  home_fatigue_score INTEGER NOT NULL,
  away_fatigue_score INTEGER NOT NULL,
  game_result TEXT,
  recommended_side_won BOOLEAN,
  spread_covered BOOLEAN,
  total_result TEXT,
  actual_spread NUMERIC,
  actual_total NUMERIC,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster queries
CREATE INDEX idx_fatigue_edge_game_date ON public.fatigue_edge_tracking(game_date);
CREATE INDEX idx_fatigue_edge_differential ON public.fatigue_edge_tracking(fatigue_differential);

-- Enable RLS
ALTER TABLE public.fatigue_edge_tracking ENABLE ROW LEVEL SECURITY;

-- Anyone can view fatigue tracking data
CREATE POLICY "Anyone can view fatigue edge tracking"
  ON public.fatigue_edge_tracking
  FOR SELECT
  USING (true);

-- Create aggregated stats view function
CREATE OR REPLACE FUNCTION public.get_fatigue_edge_accuracy()
RETURNS TABLE (
  differential_bucket TEXT,
  total_games INTEGER,
  verified_games INTEGER,
  wins INTEGER,
  losses INTEGER,
  win_rate NUMERIC,
  avg_differential NUMERIC,
  roi_percentage NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN fatigue_differential >= 30 THEN '30+'
      WHEN fatigue_differential >= 20 THEN '20-29'
      WHEN fatigue_differential >= 15 THEN '15-19'
      ELSE '<15'
    END as differential_bucket,
    COUNT(*)::INTEGER as total_games,
    COUNT(*) FILTER (WHERE recommended_side_won IS NOT NULL)::INTEGER as verified_games,
    COUNT(*) FILTER (WHERE recommended_side_won = true)::INTEGER as wins,
    COUNT(*) FILTER (WHERE recommended_side_won = false)::INTEGER as losses,
    CASE 
      WHEN COUNT(*) FILTER (WHERE recommended_side_won IS NOT NULL) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE recommended_side_won = true)::NUMERIC / 
           COUNT(*) FILTER (WHERE recommended_side_won IS NOT NULL) * 100, 1)
      ELSE 0
    END as win_rate,
    ROUND(AVG(fatigue_differential), 1) as avg_differential,
    CASE 
      WHEN COUNT(*) FILTER (WHERE recommended_side_won IS NOT NULL) > 0 
      THEN ROUND(
        (COUNT(*) FILTER (WHERE recommended_side_won = true) * 0.91 - 
         COUNT(*) FILTER (WHERE recommended_side_won = false)) / 
        NULLIF(COUNT(*) FILTER (WHERE recommended_side_won IS NOT NULL), 0) * 100, 1)
      ELSE 0
    END as roi_percentage
  FROM fatigue_edge_tracking
  WHERE fatigue_differential >= 15
  GROUP BY 
    CASE 
      WHEN fatigue_differential >= 30 THEN '30+'
      WHEN fatigue_differential >= 20 THEN '20-29'
      WHEN fatigue_differential >= 15 THEN '15-19'
      ELSE '<15'
    END
  ORDER BY avg_differential DESC;
END;
$$;
