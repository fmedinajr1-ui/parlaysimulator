-- Phase 1: Add outcome columns to juiced_props
ALTER TABLE juiced_props 
ADD COLUMN IF NOT EXISTS outcome TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS actual_value NUMERIC,
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE;

-- Create juiced_props_accuracy_metrics table
CREATE TABLE IF NOT EXISTS public.juiced_props_accuracy_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  juice_level TEXT NOT NULL,
  juice_direction TEXT NOT NULL,
  prop_type TEXT,
  sport TEXT,
  total_picks INTEGER NOT NULL DEFAULT 0,
  total_won INTEGER NOT NULL DEFAULT 0,
  total_lost INTEGER NOT NULL DEFAULT 0,
  total_push INTEGER NOT NULL DEFAULT 0,
  win_rate NUMERIC NOT NULL DEFAULT 0,
  avg_juice_amount NUMERIC NOT NULL DEFAULT 0,
  roi_percentage NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT juiced_props_accuracy_unique UNIQUE (juice_level, juice_direction, prop_type, sport)
);

-- Enable RLS on juiced_props_accuracy_metrics
ALTER TABLE public.juiced_props_accuracy_metrics ENABLE ROW LEVEL SECURITY;

-- Create policy for viewing
CREATE POLICY "Anyone can view juiced props accuracy" 
ON public.juiced_props_accuracy_metrics 
FOR SELECT 
USING (true);

-- Phase 2: Add unique constraint to hitrate_accuracy_metrics
ALTER TABLE hitrate_accuracy_metrics 
DROP CONSTRAINT IF EXISTS hitrate_accuracy_metrics_unique;

ALTER TABLE hitrate_accuracy_metrics 
ADD CONSTRAINT hitrate_accuracy_metrics_unique 
UNIQUE (strategy_type, sport, prop_type);

-- Phase 3: Create upset_calibration_factors table for better tracking
CREATE TABLE IF NOT EXISTS public.upset_calibration_factors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  confidence_level TEXT NOT NULL,
  score_range_min INTEGER NOT NULL DEFAULT 0,
  score_range_max INTEGER NOT NULL DEFAULT 100,
  total_predictions INTEGER NOT NULL DEFAULT 0,
  correct_predictions INTEGER NOT NULL DEFAULT 0,
  accuracy_rate NUMERIC NOT NULL DEFAULT 0,
  expected_accuracy NUMERIC NOT NULL DEFAULT 0,
  calibration_factor NUMERIC NOT NULL DEFAULT 1.0,
  roi_percentage NUMERIC NOT NULL DEFAULT 0,
  avg_odds NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT upset_calibration_unique UNIQUE (sport, confidence_level, score_range_min, score_range_max)
);

-- Enable RLS
ALTER TABLE public.upset_calibration_factors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view upset calibration" 
ON public.upset_calibration_factors 
FOR SELECT 
USING (true);

-- Create function for updating upset calibration
CREATE OR REPLACE FUNCTION public.update_upset_calibration()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  score_ranges INTEGER[][] := ARRAY[[0,30], [31,60], [61,100]];
  confidence_levels TEXT[] := ARRAY['low', 'medium', 'high'];
  r INTEGER[];
  c TEXT;
BEGIN
  -- Iterate through all combinations
  FOREACH r SLICE 1 IN ARRAY score_ranges LOOP
    FOREACH c IN ARRAY confidence_levels LOOP
      INSERT INTO upset_calibration_factors (
        sport, confidence_level, score_range_min, score_range_max,
        total_predictions, correct_predictions, accuracy_rate,
        expected_accuracy, calibration_factor, roi_percentage, avg_odds
      )
      SELECT 
        up.sport,
        c,
        r[1],
        r[2],
        COUNT(*)::INTEGER,
        COUNT(*) FILTER (WHERE was_upset = true)::INTEGER,
        CASE 
          WHEN COUNT(*) FILTER (WHERE game_completed = true) > 0 
          THEN ROUND(COUNT(*) FILTER (WHERE was_upset = true)::NUMERIC / COUNT(*) FILTER (WHERE game_completed = true) * 100, 1)
          ELSE 0
        END,
        -- Expected accuracy based on upset score range
        CASE 
          WHEN r[1] = 0 THEN 15  -- Low scores = ~15% expected
          WHEN r[1] = 31 THEN 25 -- Medium scores = ~25% expected
          ELSE 40                 -- High scores = ~40% expected
        END,
        -- Calibration factor
        CASE 
          WHEN COUNT(*) FILTER (WHERE game_completed = true) >= 10 THEN
            ROUND(
              (COUNT(*) FILTER (WHERE was_upset = true)::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE game_completed = true), 0) * 100) /
              NULLIF(CASE WHEN r[1] = 0 THEN 15 WHEN r[1] = 31 THEN 25 ELSE 40 END, 0),
              2
            )
          ELSE 1.0
        END,
        -- ROI calculation (assuming -110 standard juice)
        CASE 
          WHEN COUNT(*) FILTER (WHERE game_completed = true) > 0 THEN
            ROUND(
              (COUNT(*) FILTER (WHERE was_upset = true) * 0.91 - 
               COUNT(*) FILTER (WHERE was_upset = false AND game_completed = true)) / 
              NULLIF(COUNT(*) FILTER (WHERE game_completed = true), 0) * 100, 1
            )
          ELSE 0
        END,
        COALESCE(AVG(underdog_odds), 200)
      FROM upset_predictions up
      WHERE up.confidence = c
        AND up.upset_score >= r[1]
        AND up.upset_score <= r[2]
        AND up.game_completed = true
      GROUP BY up.sport
      ON CONFLICT (sport, confidence_level, score_range_min, score_range_max)
      DO UPDATE SET
        total_predictions = EXCLUDED.total_predictions,
        correct_predictions = EXCLUDED.correct_predictions,
        accuracy_rate = EXCLUDED.accuracy_rate,
        calibration_factor = EXCLUDED.calibration_factor,
        roi_percentage = EXCLUDED.roi_percentage,
        avg_odds = EXCLUDED.avg_odds,
        updated_at = now();
    END LOOP;
  END LOOP;
END;
$$;

-- Create unified accuracy summary function
CREATE OR REPLACE FUNCTION public.get_complete_accuracy_summary()
RETURNS TABLE (
  system_name TEXT,
  category TEXT,
  total_predictions INTEGER,
  verified_predictions INTEGER,
  correct_predictions INTEGER,
  accuracy_rate NUMERIC,
  roi_percentage NUMERIC,
  sample_confidence TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Juiced Props Accuracy
  RETURN QUERY
  SELECT 
    'juiced_props'::TEXT as system_name,
    (jp.juice_level || ' ' || jp.juice_direction)::TEXT as category,
    COUNT(*)::INTEGER as total_predictions,
    COUNT(*) FILTER (WHERE jp.outcome != 'pending')::INTEGER as verified_predictions,
    COUNT(*) FILTER (WHERE jp.outcome = 'won')::INTEGER as correct_predictions,
    CASE 
      WHEN COUNT(*) FILTER (WHERE jp.outcome != 'pending') > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE jp.outcome = 'won')::NUMERIC / COUNT(*) FILTER (WHERE jp.outcome != 'pending') * 100, 1)
      ELSE 0
    END as accuracy_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE jp.outcome != 'pending') > 0 THEN
        ROUND(
          (COUNT(*) FILTER (WHERE jp.outcome = 'won') * 0.91 - 
           COUNT(*) FILTER (WHERE jp.outcome = 'lost')) / 
          NULLIF(COUNT(*) FILTER (WHERE jp.outcome != 'pending'), 0) * 100, 1
        )
      ELSE 0
    END as roi_percentage,
    CASE 
      WHEN COUNT(*) FILTER (WHERE jp.outcome != 'pending') >= 50 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE jp.outcome != 'pending') >= 20 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE jp.outcome != 'pending') >= 10 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM juiced_props jp
  WHERE jp.final_pick IS NOT NULL
  GROUP BY jp.juice_level, jp.juice_direction;

  -- Hit Rate Parlays Accuracy
  RETURN QUERY
  SELECT 
    'hitrate_parlays'::TEXT as system_name,
    hp.strategy_type::TEXT as category,
    COUNT(*)::INTEGER as total_predictions,
    COUNT(*) FILTER (WHERE hp.outcome != 'pending')::INTEGER as verified_predictions,
    COUNT(*) FILTER (WHERE hp.outcome = 'won')::INTEGER as correct_predictions,
    CASE 
      WHEN COUNT(*) FILTER (WHERE hp.outcome != 'pending') > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE hp.outcome = 'won')::NUMERIC / COUNT(*) FILTER (WHERE hp.outcome != 'pending') * 100, 1)
      ELSE 0
    END as accuracy_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE hp.outcome != 'pending') > 0 THEN
        ROUND(
          (COUNT(*) FILTER (WHERE hp.outcome = 'won') * COALESCE(AVG(hp.total_odds), 1) - 
           COUNT(*) FILTER (WHERE hp.outcome != 'pending')) / 
          NULLIF(COUNT(*) FILTER (WHERE hp.outcome != 'pending'), 0) * 100, 1
        )
      ELSE 0
    END as roi_percentage,
    CASE 
      WHEN COUNT(*) FILTER (WHERE hp.outcome != 'pending') >= 50 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE hp.outcome != 'pending') >= 20 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE hp.outcome != 'pending') >= 10 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM hitrate_parlays hp
  GROUP BY hp.strategy_type;

  -- Upset Predictions Accuracy
  RETURN QUERY
  SELECT 
    'upset_predictions'::TEXT as system_name,
    (up.sport || ' - ' || up.confidence)::TEXT as category,
    COUNT(*)::INTEGER as total_predictions,
    COUNT(*) FILTER (WHERE up.game_completed = true)::INTEGER as verified_predictions,
    COUNT(*) FILTER (WHERE up.was_upset = true)::INTEGER as correct_predictions,
    CASE 
      WHEN COUNT(*) FILTER (WHERE up.game_completed = true) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE up.was_upset = true)::NUMERIC / COUNT(*) FILTER (WHERE up.game_completed = true) * 100, 1)
      ELSE 0
    END as accuracy_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE up.game_completed = true) > 0 THEN
        ROUND(
          (COUNT(*) FILTER (WHERE up.was_upset = true) * (COALESCE(AVG(up.underdog_odds), 200) / 100) - 
           COUNT(*) FILTER (WHERE up.game_completed = true)) / 
          NULLIF(COUNT(*) FILTER (WHERE up.game_completed = true), 0) * 100, 1
        )
      ELSE 0
    END as roi_percentage,
    CASE 
      WHEN COUNT(*) FILTER (WHERE up.game_completed = true) >= 50 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE up.game_completed = true) >= 20 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE up.game_completed = true) >= 10 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM upset_predictions up
  GROUP BY up.sport, up.confidence;

  -- Sharp Money Accuracy
  RETURN QUERY
  SELECT 
    'sharp_money'::TEXT as system_name,
    lm.recommendation::TEXT as category,
    COUNT(*)::INTEGER as total_predictions,
    COUNT(*) FILTER (WHERE lm.outcome_verified = true)::INTEGER as verified_predictions,
    COUNT(*) FILTER (WHERE lm.outcome_correct = true)::INTEGER as correct_predictions,
    CASE 
      WHEN COUNT(*) FILTER (WHERE lm.outcome_verified = true) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE lm.outcome_correct = true)::NUMERIC / COUNT(*) FILTER (WHERE lm.outcome_verified = true) * 100, 1)
      ELSE 0
    END as accuracy_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE lm.outcome_verified = true) > 0 THEN
        ROUND(
          (COUNT(*) FILTER (WHERE lm.outcome_correct = true) * 0.91 - 
           COUNT(*) FILTER (WHERE lm.outcome_correct = false)) / 
          NULLIF(COUNT(*) FILTER (WHERE lm.outcome_verified = true), 0) * 100, 1
        )
      ELSE 0
    END as roi_percentage,
    CASE 
      WHEN COUNT(*) FILTER (WHERE lm.outcome_verified = true) >= 50 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE lm.outcome_verified = true) >= 20 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE lm.outcome_verified = true) >= 10 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM line_movements lm
  WHERE lm.is_primary_record = true AND lm.recommendation IS NOT NULL
  GROUP BY lm.recommendation;
END;
$$;