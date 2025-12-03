-- Create AI calibration factors table to track predicted vs actual win rates
CREATE TABLE IF NOT EXISTS public.ai_calibration_factors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  bet_type TEXT NOT NULL,
  odds_bucket TEXT NOT NULL, -- e.g., "-500 to -300", "-300 to -150", etc.
  predicted_probability NUMERIC NOT NULL DEFAULT 0,
  actual_win_rate NUMERIC NOT NULL DEFAULT 0,
  calibration_factor NUMERIC NOT NULL DEFAULT 1.0,
  sample_size INTEGER NOT NULL DEFAULT 0,
  total_wins INTEGER NOT NULL DEFAULT 0,
  total_bets INTEGER NOT NULL DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(sport, bet_type, odds_bucket)
);

-- Create strategy performance table to track which suggestion strategies work best
CREATE TABLE IF NOT EXISTS public.strategy_performance (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_name TEXT NOT NULL UNIQUE, -- e.g., "VERIFIED_SHARP", "FADE_PARLAY", "LOW_RISK"
  total_suggestions INTEGER NOT NULL DEFAULT 0,
  total_won INTEGER NOT NULL DEFAULT 0,
  total_lost INTEGER NOT NULL DEFAULT 0,
  total_pending INTEGER NOT NULL DEFAULT 0,
  avg_odds NUMERIC NOT NULL DEFAULT 0,
  roi_percentage NUMERIC NOT NULL DEFAULT 0,
  confidence_adjustment NUMERIC NOT NULL DEFAULT 1.0, -- multiplier based on historical performance
  win_rate NUMERIC NOT NULL DEFAULT 0,
  last_updated TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.ai_calibration_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strategy_performance ENABLE ROW LEVEL SECURITY;

-- Anyone can view calibration factors and strategy performance
CREATE POLICY "Anyone can view calibration factors" ON public.ai_calibration_factors FOR SELECT USING (true);
CREATE POLICY "Anyone can view strategy performance" ON public.strategy_performance FOR SELECT USING (true);

-- Create function to calculate calibration factors from historical data
CREATE OR REPLACE FUNCTION public.calculate_calibration_factors()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  odds_ranges TEXT[] := ARRAY['-500_to_-300', '-300_to_-200', '-200_to_-150', '-150_to_-110', '-110_to_100', '100_to_150', '150_to_200', '200_to_300', '300_to_500'];
  range_record RECORD;
  min_odds NUMERIC;
  max_odds NUMERIC;
BEGIN
  -- Clear existing factors (will be recalculated)
  DELETE FROM ai_calibration_factors WHERE sample_size < 3;
  
  -- Calculate calibration factors for each sport/bet_type/odds_bucket combination
  FOR range_record IN
    SELECT 
      COALESCE(sport, 'unknown') as sport,
      COALESCE(bet_type, 'unknown') as bet_type,
      CASE 
        WHEN odds <= -300 THEN '-500_to_-300'
        WHEN odds <= -200 THEN '-300_to_-200'
        WHEN odds <= -150 THEN '-200_to_-150'
        WHEN odds <= -110 THEN '-150_to_-110'
        WHEN odds <= 100 THEN '-110_to_100'
        WHEN odds <= 150 THEN '100_to_150'
        WHEN odds <= 200 THEN '150_to_200'
        WHEN odds <= 300 THEN '200_to_300'
        ELSE '300_to_500'
      END as odds_bucket,
      AVG(implied_probability) as predicted_probability,
      COUNT(*) FILTER (WHERE parlay_outcome = true)::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE parlay_outcome IS NOT NULL), 0) as actual_win_rate,
      COUNT(*) FILTER (WHERE parlay_outcome IS NOT NULL) as sample_size,
      COUNT(*) FILTER (WHERE parlay_outcome = true) as total_wins,
      COUNT(*) FILTER (WHERE parlay_outcome IS NOT NULL) as total_bets
    FROM parlay_training_data
    WHERE parlay_outcome IS NOT NULL
    GROUP BY sport, bet_type,
      CASE 
        WHEN odds <= -300 THEN '-500_to_-300'
        WHEN odds <= -200 THEN '-300_to_-200'
        WHEN odds <= -150 THEN '-200_to_-150'
        WHEN odds <= -110 THEN '-150_to_-110'
        WHEN odds <= 100 THEN '-110_to_100'
        WHEN odds <= 150 THEN '100_to_150'
        WHEN odds <= 200 THEN '150_to_200'
        WHEN odds <= 300 THEN '200_to_300'
        ELSE '300_to_500'
      END
    HAVING COUNT(*) FILTER (WHERE parlay_outcome IS NOT NULL) >= 3
  LOOP
    INSERT INTO ai_calibration_factors (
      sport, bet_type, odds_bucket, 
      predicted_probability, actual_win_rate, 
      calibration_factor, sample_size, total_wins, total_bets,
      last_updated
    )
    VALUES (
      range_record.sport,
      range_record.bet_type,
      range_record.odds_bucket,
      COALESCE(range_record.predicted_probability, 0.5),
      COALESCE(range_record.actual_win_rate, 0.5),
      CASE 
        WHEN COALESCE(range_record.predicted_probability, 0) > 0 
        THEN COALESCE(range_record.actual_win_rate, 0.5) / range_record.predicted_probability
        ELSE 1.0
      END,
      range_record.sample_size,
      range_record.total_wins,
      range_record.total_bets,
      now()
    )
    ON CONFLICT (sport, bet_type, odds_bucket)
    DO UPDATE SET
      predicted_probability = EXCLUDED.predicted_probability,
      actual_win_rate = EXCLUDED.actual_win_rate,
      calibration_factor = EXCLUDED.calibration_factor,
      sample_size = EXCLUDED.sample_size,
      total_wins = EXCLUDED.total_wins,
      total_bets = EXCLUDED.total_bets,
      last_updated = now();
  END LOOP;
END;
$$;

-- Create function to get calibrated probability
CREATE OR REPLACE FUNCTION public.get_calibrated_probability(
  p_sport TEXT,
  p_bet_type TEXT,
  p_odds NUMERIC
)
RETURNS TABLE(
  calibrated_probability NUMERIC,
  calibration_factor NUMERIC,
  sample_size INTEGER,
  confidence_level TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_odds_bucket TEXT;
  v_factor RECORD;
BEGIN
  -- Determine odds bucket
  v_odds_bucket := CASE 
    WHEN p_odds <= -300 THEN '-500_to_-300'
    WHEN p_odds <= -200 THEN '-300_to_-200'
    WHEN p_odds <= -150 THEN '-200_to_-150'
    WHEN p_odds <= -110 THEN '-150_to_-110'
    WHEN p_odds <= 100 THEN '-110_to_100'
    WHEN p_odds <= 150 THEN '100_to_150'
    WHEN p_odds <= 200 THEN '150_to_200'
    WHEN p_odds <= 300 THEN '200_to_300'
    ELSE '300_to_500'
  END;
  
  -- Look for exact match first
  SELECT * INTO v_factor FROM ai_calibration_factors 
  WHERE sport = p_sport AND bet_type = p_bet_type AND odds_bucket = v_odds_bucket;
  
  -- If no exact match, try sport + odds_bucket
  IF v_factor IS NULL THEN
    SELECT * INTO v_factor FROM ai_calibration_factors 
    WHERE sport = p_sport AND odds_bucket = v_odds_bucket
    LIMIT 1;
  END IF;
  
  -- If still no match, try just odds_bucket
  IF v_factor IS NULL THEN
    SELECT * INTO v_factor FROM ai_calibration_factors 
    WHERE odds_bucket = v_odds_bucket
    LIMIT 1;
  END IF;
  
  -- Calculate implied probability from American odds
  DECLARE
    v_implied_prob NUMERIC;
  BEGIN
    IF p_odds > 0 THEN
      v_implied_prob := 100.0 / (p_odds + 100);
    ELSE
      v_implied_prob := ABS(p_odds)::NUMERIC / (ABS(p_odds) + 100);
    END IF;
    
    IF v_factor IS NOT NULL AND v_factor.sample_size >= 5 THEN
      RETURN QUERY SELECT 
        v_implied_prob * v_factor.calibration_factor,
        v_factor.calibration_factor,
        v_factor.sample_size,
        CASE 
          WHEN v_factor.sample_size >= 20 THEN 'high'
          WHEN v_factor.sample_size >= 10 THEN 'medium'
          ELSE 'low'
        END;
    ELSE
      RETURN QUERY SELECT 
        v_implied_prob,
        1.0::NUMERIC,
        0::INTEGER,
        'none'::TEXT;
    END IF;
  END;
END;
$$;

-- Create function to update strategy performance
CREATE OR REPLACE FUNCTION public.update_strategy_performance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Update strategy performance from suggestion_performance data
  INSERT INTO strategy_performance (
    strategy_name, total_suggestions, total_won, total_lost, total_pending,
    avg_odds, roi_percentage, confidence_adjustment, win_rate
  )
  SELECT 
    CASE 
      WHEN sp.suggestion_reason ILIKE '%very low risk%' THEN 'VERY_LOW_RISK'
      WHEN sp.suggestion_reason ILIKE '%low risk%' THEN 'LOW_RISK'
      WHEN sp.suggestion_reason ILIKE '%fade%' THEN 'FADE'
      WHEN sp.suggestion_reason ILIKE '%verified sharp%' OR sp.suggestion_reason ILIKE '%high-confidence%real%sharp%' THEN 'VERIFIED_SHARP'
      WHEN sp.suggestion_reason ILIKE '%sharp%' THEN 'SHARP_PROPS'
      WHEN sp.suggestion_reason ILIKE '%data-driven%' THEN 'DATA_DRIVEN'
      WHEN sp.suggestion_reason ILIKE '%hitrate%' OR sp.suggestion_reason ILIKE '%hit rate%' THEN 'HIT_RATE'
      ELSE 'OTHER'
    END as strategy_name,
    COUNT(*) as total_suggestions,
    COUNT(*) FILTER (WHERE perf.outcome = true) as total_won,
    COUNT(*) FILTER (WHERE perf.outcome = false) as total_lost,
    COUNT(*) FILTER (WHERE perf.outcome IS NULL) as total_pending,
    COALESCE(AVG(sp.total_odds), 0) as avg_odds,
    CASE 
      WHEN SUM(perf.stake) > 0 
      THEN ROUND(
        (SUM(CASE WHEN perf.outcome = true THEN COALESCE(perf.payout, 0) - perf.stake WHEN perf.outcome = false THEN -perf.stake ELSE 0 END) / SUM(perf.stake)) * 100, 
        1
      )
      ELSE 0
    END as roi_percentage,
    CASE 
      WHEN COUNT(*) FILTER (WHERE perf.outcome IS NOT NULL) >= 10 
      THEN ROUND(COUNT(*) FILTER (WHERE perf.outcome = true)::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE perf.outcome IS NOT NULL), 0), 2)
      ELSE 1.0
    END as confidence_adjustment,
    ROUND(COUNT(*) FILTER (WHERE perf.outcome = true)::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE perf.outcome IS NOT NULL), 0) * 100, 1) as win_rate
  FROM suggestion_performance perf
  JOIN suggested_parlays sp ON perf.suggested_parlay_id = sp.id
  GROUP BY 
    CASE 
      WHEN sp.suggestion_reason ILIKE '%very low risk%' THEN 'VERY_LOW_RISK'
      WHEN sp.suggestion_reason ILIKE '%low risk%' THEN 'LOW_RISK'
      WHEN sp.suggestion_reason ILIKE '%fade%' THEN 'FADE'
      WHEN sp.suggestion_reason ILIKE '%verified sharp%' OR sp.suggestion_reason ILIKE '%high-confidence%real%sharp%' THEN 'VERIFIED_SHARP'
      WHEN sp.suggestion_reason ILIKE '%sharp%' THEN 'SHARP_PROPS'
      WHEN sp.suggestion_reason ILIKE '%data-driven%' THEN 'DATA_DRIVEN'
      WHEN sp.suggestion_reason ILIKE '%hitrate%' OR sp.suggestion_reason ILIKE '%hit rate%' THEN 'HIT_RATE'
      ELSE 'OTHER'
    END
  ON CONFLICT (strategy_name)
  DO UPDATE SET
    total_suggestions = EXCLUDED.total_suggestions,
    total_won = EXCLUDED.total_won,
    total_lost = EXCLUDED.total_lost,
    total_pending = EXCLUDED.total_pending,
    avg_odds = EXCLUDED.avg_odds,
    roi_percentage = EXCLUDED.roi_percentage,
    confidence_adjustment = EXCLUDED.confidence_adjustment,
    win_rate = EXCLUDED.win_rate,
    last_updated = now();
END;
$$;

-- Add columns to line_movements for better outcome tracking
ALTER TABLE public.line_movements 
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS game_result TEXT;

-- Create index for faster calibration lookups
CREATE INDEX IF NOT EXISTS idx_calibration_lookup ON ai_calibration_factors(sport, bet_type, odds_bucket);
CREATE INDEX IF NOT EXISTS idx_strategy_name ON strategy_performance(strategy_name);