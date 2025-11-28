-- Create parlay_training_data table for storing detailed leg-level AI analysis
CREATE TABLE public.parlay_training_data (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parlay_history_id UUID NOT NULL REFERENCES public.parlay_history(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  leg_index INTEGER NOT NULL,
  description TEXT NOT NULL,
  odds NUMERIC NOT NULL,
  implied_probability NUMERIC NOT NULL,
  sport TEXT,
  bet_type TEXT,
  team TEXT,
  player TEXT,
  ai_adjusted_probability NUMERIC,
  ai_confidence TEXT,
  ai_trend_direction TEXT,
  vegas_juice NUMERIC,
  is_correlated BOOLEAN DEFAULT false,
  leg_outcome BOOLEAN,
  parlay_outcome BOOLEAN,
  settled_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create ai_performance_metrics table for tracking AI accuracy
CREATE TABLE public.ai_performance_metrics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  bet_type TEXT NOT NULL,
  confidence_level TEXT NOT NULL,
  total_predictions INTEGER NOT NULL DEFAULT 0,
  correct_predictions INTEGER NOT NULL DEFAULT 0,
  accuracy_rate NUMERIC NOT NULL DEFAULT 0,
  avg_odds NUMERIC NOT NULL DEFAULT 0,
  profit_units NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(sport, bet_type, confidence_level)
);

-- Enable RLS on both tables
ALTER TABLE public.parlay_training_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_performance_metrics ENABLE ROW LEVEL SECURITY;

-- RLS policies for parlay_training_data
CREATE POLICY "Users can view their own training data"
ON public.parlay_training_data
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own training data"
ON public.parlay_training_data
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own training data"
ON public.parlay_training_data
FOR UPDATE
USING (auth.uid() = user_id);

-- RLS policies for ai_performance_metrics (public read, service role write)
CREATE POLICY "Anyone can view AI metrics"
ON public.ai_performance_metrics
FOR SELECT
USING (true);

-- Create indexes for efficient querying
CREATE INDEX idx_training_data_user ON public.parlay_training_data(user_id);
CREATE INDEX idx_training_data_sport ON public.parlay_training_data(sport);
CREATE INDEX idx_training_data_bet_type ON public.parlay_training_data(bet_type);
CREATE INDEX idx_training_data_parlay ON public.parlay_training_data(parlay_history_id);
CREATE INDEX idx_performance_sport_type ON public.ai_performance_metrics(sport, bet_type);

-- Function to get user's historical performance
CREATE OR REPLACE FUNCTION public.get_user_betting_stats(p_user_id UUID)
RETURNS TABLE(
  sport TEXT,
  bet_type TEXT,
  total_bets BIGINT,
  wins BIGINT,
  hit_rate NUMERIC,
  avg_odds NUMERIC,
  by_confidence JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ptd.sport,
    ptd.bet_type,
    COUNT(*) as total_bets,
    COUNT(*) FILTER (WHERE ptd.parlay_outcome = true) as wins,
    ROUND(COUNT(*) FILTER (WHERE ptd.parlay_outcome = true)::NUMERIC / NULLIF(COUNT(*), 0) * 100, 1) as hit_rate,
    ROUND(AVG(ptd.odds), 0) as avg_odds,
    jsonb_build_object(
      'high', jsonb_build_object(
        'total', COUNT(*) FILTER (WHERE ptd.ai_confidence = 'high'),
        'wins', COUNT(*) FILTER (WHERE ptd.ai_confidence = 'high' AND ptd.parlay_outcome = true)
      ),
      'medium', jsonb_build_object(
        'total', COUNT(*) FILTER (WHERE ptd.ai_confidence = 'medium'),
        'wins', COUNT(*) FILTER (WHERE ptd.ai_confidence = 'medium' AND ptd.parlay_outcome = true)
      ),
      'low', jsonb_build_object(
        'total', COUNT(*) FILTER (WHERE ptd.ai_confidence = 'low'),
        'wins', COUNT(*) FILTER (WHERE ptd.ai_confidence = 'low' AND ptd.parlay_outcome = true)
      )
    ) as by_confidence
  FROM parlay_training_data ptd
  WHERE ptd.user_id = p_user_id
    AND ptd.parlay_outcome IS NOT NULL
  GROUP BY ptd.sport, ptd.bet_type;
END;
$$;

-- Function to get global AI performance metrics
CREATE OR REPLACE FUNCTION public.get_ai_accuracy_stats()
RETURNS TABLE(
  sport TEXT,
  bet_type TEXT,
  confidence_level TEXT,
  total_predictions INTEGER,
  correct_predictions INTEGER,
  accuracy_rate NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    apm.sport,
    apm.bet_type,
    apm.confidence_level,
    apm.total_predictions,
    apm.correct_predictions,
    apm.accuracy_rate
  FROM ai_performance_metrics apm
  WHERE apm.total_predictions >= 5
  ORDER BY apm.accuracy_rate DESC;
END;
$$;

-- Function to update AI performance metrics after settling
CREATE OR REPLACE FUNCTION public.update_ai_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.parlay_outcome IS NOT NULL AND OLD.parlay_outcome IS NULL THEN
    INSERT INTO ai_performance_metrics (sport, bet_type, confidence_level, total_predictions, correct_predictions, accuracy_rate, avg_odds)
    VALUES (
      COALESCE(NEW.sport, 'unknown'),
      COALESCE(NEW.bet_type, 'unknown'),
      COALESCE(NEW.ai_confidence, 'unknown'),
      1,
      CASE WHEN NEW.parlay_outcome THEN 1 ELSE 0 END,
      CASE WHEN NEW.parlay_outcome THEN 100 ELSE 0 END,
      COALESCE(NEW.odds, 0)
    )
    ON CONFLICT (sport, bet_type, confidence_level)
    DO UPDATE SET
      total_predictions = ai_performance_metrics.total_predictions + 1,
      correct_predictions = ai_performance_metrics.correct_predictions + CASE WHEN NEW.parlay_outcome THEN 1 ELSE 0 END,
      accuracy_rate = ROUND(
        (ai_performance_metrics.correct_predictions + CASE WHEN NEW.parlay_outcome THEN 1 ELSE 0 END)::NUMERIC 
        / (ai_performance_metrics.total_predictions + 1) * 100, 1
      ),
      avg_odds = ROUND(
        (ai_performance_metrics.avg_odds * ai_performance_metrics.total_predictions + COALESCE(NEW.odds, 0))
        / (ai_performance_metrics.total_predictions + 1), 0
      ),
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger to auto-update metrics when training data is settled
CREATE TRIGGER trigger_update_ai_metrics
AFTER UPDATE ON public.parlay_training_data
FOR EACH ROW
EXECUTE FUNCTION public.update_ai_metrics();