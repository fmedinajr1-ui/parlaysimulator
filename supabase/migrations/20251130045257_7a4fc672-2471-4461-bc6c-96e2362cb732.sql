-- Create suggestion accuracy metrics table
CREATE TABLE public.suggestion_accuracy_metrics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  confidence_level TEXT NOT NULL,
  suggestion_strategy TEXT NOT NULL DEFAULT 'general',
  total_suggestions INTEGER NOT NULL DEFAULT 0,
  total_won INTEGER NOT NULL DEFAULT 0,
  total_lost INTEGER NOT NULL DEFAULT 0,
  accuracy_rate NUMERIC NOT NULL DEFAULT 0,
  avg_odds NUMERIC NOT NULL DEFAULT 0,
  roi_percentage NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sport, confidence_level, suggestion_strategy)
);

-- Enable RLS
ALTER TABLE public.suggestion_accuracy_metrics ENABLE ROW LEVEL SECURITY;

-- Anyone can view metrics (public data for transparency)
CREATE POLICY "Anyone can view suggestion metrics"
ON public.suggestion_accuracy_metrics
FOR SELECT USING (true);

-- Create function to update suggestion accuracy metrics
CREATE OR REPLACE FUNCTION public.update_suggestion_accuracy_metrics()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sport TEXT;
  v_confidence TEXT;
  v_odds NUMERIC;
BEGIN
  -- Only trigger when outcome changes from NULL to a value
  IF NEW.outcome IS NOT NULL AND OLD.outcome IS NULL THEN
    -- Get suggestion details
    SELECT sport, 
           CASE 
             WHEN confidence_score >= 0.7 THEN 'high'
             WHEN confidence_score >= 0.4 THEN 'medium'
             ELSE 'low'
           END,
           total_odds
    INTO v_sport, v_confidence, v_odds
    FROM suggested_parlays
    WHERE id = NEW.suggested_parlay_id;
    
    -- Update or insert metrics
    INSERT INTO suggestion_accuracy_metrics (
      sport, confidence_level, suggestion_strategy, 
      total_suggestions, total_won, total_lost, 
      accuracy_rate, avg_odds, roi_percentage
    )
    VALUES (
      v_sport, v_confidence, 'general',
      1,
      CASE WHEN NEW.outcome THEN 1 ELSE 0 END,
      CASE WHEN NEW.outcome THEN 0 ELSE 1 END,
      CASE WHEN NEW.outcome THEN 100 ELSE 0 END,
      v_odds,
      CASE WHEN NEW.outcome THEN (v_odds - 1) * 100 ELSE -100 END
    )
    ON CONFLICT (sport, confidence_level, suggestion_strategy)
    DO UPDATE SET
      total_suggestions = suggestion_accuracy_metrics.total_suggestions + 1,
      total_won = suggestion_accuracy_metrics.total_won + CASE WHEN NEW.outcome THEN 1 ELSE 0 END,
      total_lost = suggestion_accuracy_metrics.total_lost + CASE WHEN NEW.outcome THEN 0 ELSE 1 END,
      accuracy_rate = ROUND(
        (suggestion_accuracy_metrics.total_won + CASE WHEN NEW.outcome THEN 1 ELSE 0 END)::NUMERIC 
        / (suggestion_accuracy_metrics.total_suggestions + 1) * 100, 1
      ),
      avg_odds = ROUND(
        (suggestion_accuracy_metrics.avg_odds * suggestion_accuracy_metrics.total_suggestions + v_odds)
        / (suggestion_accuracy_metrics.total_suggestions + 1), 2
      ),
      roi_percentage = ROUND(
        ((suggestion_accuracy_metrics.total_won + CASE WHEN NEW.outcome THEN 1 ELSE 0 END) * 
         (suggestion_accuracy_metrics.avg_odds * suggestion_accuracy_metrics.total_suggestions + v_odds) / 
         (suggestion_accuracy_metrics.total_suggestions + 1) - 
         (suggestion_accuracy_metrics.total_suggestions + 1)) 
        / (suggestion_accuracy_metrics.total_suggestions + 1) * 100, 1
      ),
      updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

-- Create trigger on suggestion_performance
CREATE TRIGGER update_accuracy_metrics_on_settle
AFTER UPDATE ON public.suggestion_performance
FOR EACH ROW
EXECUTE FUNCTION public.update_suggestion_accuracy_metrics();

-- Enable realtime for suggestion_performance
ALTER PUBLICATION supabase_realtime ADD TABLE public.suggestion_performance;

-- Create function to get suggestion accuracy by sport/confidence
CREATE OR REPLACE FUNCTION public.get_suggestion_accuracy_stats()
RETURNS TABLE(
  sport TEXT,
  confidence_level TEXT,
  total_suggestions INTEGER,
  total_won INTEGER,
  total_lost INTEGER,
  accuracy_rate NUMERIC,
  avg_odds NUMERIC,
  roi_percentage NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    sam.sport,
    sam.confidence_level,
    sam.total_suggestions,
    sam.total_won,
    sam.total_lost,
    sam.accuracy_rate,
    sam.avg_odds,
    sam.roi_percentage
  FROM suggestion_accuracy_metrics sam
  WHERE sam.total_suggestions >= 3
  ORDER BY sam.accuracy_rate DESC;
END;
$$;