-- Create table to track upset predictions and their outcomes
CREATE TABLE public.upset_predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  underdog TEXT NOT NULL,
  underdog_odds NUMERIC NOT NULL,
  favorite TEXT NOT NULL,
  favorite_odds NUMERIC NOT NULL,
  upset_score INTEGER NOT NULL,
  confidence TEXT NOT NULL DEFAULT 'low',
  signals JSONB DEFAULT '[]'::jsonb,
  ai_reasoning TEXT,
  commence_time TIMESTAMP WITH TIME ZONE NOT NULL,
  predicted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  prediction_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Outcome tracking
  game_completed BOOLEAN DEFAULT false,
  winner TEXT,
  was_upset BOOLEAN,
  verified_at TIMESTAMP WITH TIME ZONE,
  
  UNIQUE(game_id, prediction_date)
);

-- Enable RLS
ALTER TABLE public.upset_predictions ENABLE ROW LEVEL SECURITY;

-- Anyone can view predictions
CREATE POLICY "Anyone can view upset predictions"
ON public.upset_predictions
FOR SELECT
USING (true);

-- Create indexes for fast lookups
CREATE INDEX idx_upset_predictions_game_id ON public.upset_predictions(game_id);
CREATE INDEX idx_upset_predictions_sport ON public.upset_predictions(sport);
CREATE INDEX idx_upset_predictions_commence_time ON public.upset_predictions(commence_time);
CREATE INDEX idx_upset_predictions_verified ON public.upset_predictions(game_completed, was_upset);

-- Create function to get upset prediction accuracy stats
CREATE OR REPLACE FUNCTION public.get_upset_prediction_accuracy()
RETURNS TABLE(
  sport TEXT,
  confidence TEXT,
  total_predictions BIGINT,
  verified_predictions BIGINT,
  correct_predictions BIGINT,
  accuracy_rate NUMERIC,
  avg_upset_score NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    up.sport,
    up.confidence,
    COUNT(*) as total_predictions,
    COUNT(*) FILTER (WHERE up.game_completed = true) as verified_predictions,
    COUNT(*) FILTER (WHERE up.was_upset = true) as correct_predictions,
    CASE 
      WHEN COUNT(*) FILTER (WHERE up.game_completed = true) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE up.was_upset = true)::NUMERIC / COUNT(*) FILTER (WHERE up.game_completed = true) * 100, 1)
      ELSE 0
    END as accuracy_rate,
    ROUND(AVG(up.upset_score), 1) as avg_upset_score
  FROM upset_predictions up
  GROUP BY up.sport, up.confidence
  ORDER BY verified_predictions DESC, accuracy_rate DESC;
END;
$$;

-- Create function to get overall accuracy summary
CREATE OR REPLACE FUNCTION public.get_upset_accuracy_summary()
RETURNS TABLE(
  total_predictions BIGINT,
  verified_predictions BIGINT,
  correct_predictions BIGINT,
  overall_accuracy NUMERIC,
  high_confidence_accuracy NUMERIC,
  medium_confidence_accuracy NUMERIC,
  low_confidence_accuracy NUMERIC,
  by_sport JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COUNT(*) as total_predictions,
    COUNT(*) FILTER (WHERE game_completed = true) as verified_predictions,
    COUNT(*) FILTER (WHERE was_upset = true) as correct_predictions,
    CASE 
      WHEN COUNT(*) FILTER (WHERE game_completed = true) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE was_upset = true)::NUMERIC / COUNT(*) FILTER (WHERE game_completed = true) * 100, 1)
      ELSE 0
    END as overall_accuracy,
    CASE 
      WHEN COUNT(*) FILTER (WHERE game_completed = true AND confidence = 'high') > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE was_upset = true AND confidence = 'high')::NUMERIC / COUNT(*) FILTER (WHERE game_completed = true AND confidence = 'high') * 100, 1)
      ELSE 0
    END as high_confidence_accuracy,
    CASE 
      WHEN COUNT(*) FILTER (WHERE game_completed = true AND confidence = 'medium') > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE was_upset = true AND confidence = 'medium')::NUMERIC / COUNT(*) FILTER (WHERE game_completed = true AND confidence = 'medium') * 100, 1)
      ELSE 0
    END as medium_confidence_accuracy,
    CASE 
      WHEN COUNT(*) FILTER (WHERE game_completed = true AND confidence = 'low') > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE was_upset = true AND confidence = 'low')::NUMERIC / COUNT(*) FILTER (WHERE game_completed = true AND confidence = 'low') * 100, 1)
      ELSE 0
    END as low_confidence_accuracy,
    (
      SELECT jsonb_agg(jsonb_build_object(
        'sport', sub.sport,
        'total', sub.total,
        'verified', sub.verified,
        'correct', sub.correct,
        'accuracy', sub.accuracy
      ))
      FROM (
        SELECT 
          up2.sport,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE up2.game_completed = true) as verified,
          COUNT(*) FILTER (WHERE up2.was_upset = true) as correct,
          CASE 
            WHEN COUNT(*) FILTER (WHERE up2.game_completed = true) > 0 
            THEN ROUND(COUNT(*) FILTER (WHERE up2.was_upset = true)::NUMERIC / COUNT(*) FILTER (WHERE up2.game_completed = true) * 100, 1)
            ELSE 0
          END as accuracy
        FROM upset_predictions up2
        GROUP BY up2.sport
      ) sub
    ) as by_sport
  FROM upset_predictions;
END;
$$;