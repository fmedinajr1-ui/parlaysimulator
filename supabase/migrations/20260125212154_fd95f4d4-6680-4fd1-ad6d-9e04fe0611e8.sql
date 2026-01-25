-- Add projection_error column for tracking accuracy
ALTER TABLE scout_prop_outcomes
ADD COLUMN IF NOT EXISTS projection_error NUMERIC;

-- Drop constraint if exists and recreate (safe approach)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_scout_prop_outcomes_unique_entry'
  ) THEN
    ALTER TABLE scout_prop_outcomes
    ADD CONSTRAINT uq_scout_prop_outcomes_unique_entry
    UNIQUE (event_id, player_name, prop, analysis_date);
  END IF;
END $$;

-- Create RPC for projection accuracy stats
CREATE OR REPLACE FUNCTION get_scout_projection_accuracy(days_back integer DEFAULT 30)
RETURNS TABLE(
  prop TEXT,
  total_predictions BIGINT,
  avg_mae NUMERIC,
  hit_rate NUMERIC,
  within_2_pct NUMERIC,
  within_5_pct NUMERIC
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT 
    spo.prop,
    COUNT(*) as total_predictions,
    ROUND(AVG(spo.projection_error), 2) as avg_mae,
    ROUND(AVG(CASE WHEN spo.outcome = 'hit' THEN 1 ELSE 0 END), 4) as hit_rate,
    ROUND(COUNT(*) FILTER (WHERE ABS(spo.actual_final - spo.predicted_final) <= 2)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as within_2_pct,
    ROUND(COUNT(*) FILTER (WHERE ABS(spo.actual_final - spo.predicted_final) <= 5)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as within_5_pct
  FROM scout_prop_outcomes spo
  WHERE spo.analysis_date >= current_date - days_back
    AND spo.outcome IN ('hit', 'miss')
  GROUP BY spo.prop;
END;
$$;