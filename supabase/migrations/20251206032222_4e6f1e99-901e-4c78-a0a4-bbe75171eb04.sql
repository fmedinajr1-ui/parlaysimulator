-- Create function to get accuracy trends comparing last 30 days vs previous 30 days
CREATE OR REPLACE FUNCTION public.get_accuracy_trends()
RETURNS TABLE (
  category text,
  current_period_accuracy numeric,
  current_period_verified integer,
  previous_period_accuracy numeric,
  previous_period_verified integer,
  trend_direction text,
  trend_change numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_start timestamp with time zone := now() - interval '30 days';
  previous_start timestamp with time zone := now() - interval '60 days';
  previous_end timestamp with time zone := now() - interval '30 days';
BEGIN
  -- Sharp Money Trends
  RETURN QUERY
  WITH current_period AS (
    SELECT 
      COUNT(*) FILTER (WHERE outcome_verified = true) as verified,
      COUNT(*) FILTER (WHERE outcome_correct = true) as correct
    FROM line_movements
    WHERE is_primary_record = true AND detected_at >= current_start
  ),
  previous_period AS (
    SELECT 
      COUNT(*) FILTER (WHERE outcome_verified = true) as verified,
      COUNT(*) FILTER (WHERE outcome_correct = true) as correct
    FROM line_movements
    WHERE is_primary_record = true AND detected_at >= previous_start AND detected_at < previous_end
  )
  SELECT 
    'sharp_money'::text as category,
    CASE WHEN cp.verified > 0 THEN ROUND(cp.correct::numeric / cp.verified * 100, 1) ELSE 0 END as current_period_accuracy,
    cp.verified::integer as current_period_verified,
    CASE WHEN pp.verified > 0 THEN ROUND(pp.correct::numeric / pp.verified * 100, 1) ELSE 0 END as previous_period_accuracy,
    pp.verified::integer as previous_period_verified,
    CASE 
      WHEN cp.verified < 10 OR pp.verified < 10 THEN 'insufficient'
      WHEN CASE WHEN cp.verified > 0 THEN cp.correct::numeric / cp.verified ELSE 0 END > 
           CASE WHEN pp.verified > 0 THEN pp.correct::numeric / pp.verified ELSE 0 END + 0.02 THEN 'up'
      WHEN CASE WHEN cp.verified > 0 THEN cp.correct::numeric / cp.verified ELSE 0 END < 
           CASE WHEN pp.verified > 0 THEN pp.correct::numeric / pp.verified ELSE 0 END - 0.02 THEN 'down'
      ELSE 'stable'
    END as trend_direction,
    CASE WHEN cp.verified > 0 THEN ROUND(cp.correct::numeric / cp.verified * 100, 1) ELSE 0 END -
    CASE WHEN pp.verified > 0 THEN ROUND(pp.correct::numeric / pp.verified * 100, 1) ELSE 0 END as trend_change
  FROM current_period cp, previous_period pp;

  -- Upset Predictions Trends
  RETURN QUERY
  WITH current_period AS (
    SELECT 
      COUNT(*) FILTER (WHERE game_completed = true) as verified,
      COUNT(*) FILTER (WHERE was_upset = true) as correct
    FROM upset_predictions
    WHERE predicted_at >= current_start
  ),
  previous_period AS (
    SELECT 
      COUNT(*) FILTER (WHERE game_completed = true) as verified,
      COUNT(*) FILTER (WHERE was_upset = true) as correct
    FROM upset_predictions
    WHERE predicted_at >= previous_start AND predicted_at < previous_end
  )
  SELECT 
    'upset_predictions'::text,
    CASE WHEN cp.verified > 0 THEN ROUND(cp.correct::numeric / cp.verified * 100, 1) ELSE 0 END,
    cp.verified::integer,
    CASE WHEN pp.verified > 0 THEN ROUND(pp.correct::numeric / pp.verified * 100, 1) ELSE 0 END,
    pp.verified::integer,
    CASE 
      WHEN cp.verified < 5 OR pp.verified < 5 THEN 'insufficient'
      WHEN CASE WHEN cp.verified > 0 THEN cp.correct::numeric / cp.verified ELSE 0 END > 
           CASE WHEN pp.verified > 0 THEN pp.correct::numeric / pp.verified ELSE 0 END + 0.02 THEN 'up'
      WHEN CASE WHEN cp.verified > 0 THEN cp.correct::numeric / cp.verified ELSE 0 END < 
           CASE WHEN pp.verified > 0 THEN pp.correct::numeric / pp.verified ELSE 0 END - 0.02 THEN 'down'
      ELSE 'stable'
    END,
    CASE WHEN cp.verified > 0 THEN ROUND(cp.correct::numeric / cp.verified * 100, 1) ELSE 0 END -
    CASE WHEN pp.verified > 0 THEN ROUND(pp.correct::numeric / pp.verified * 100, 1) ELSE 0 END
  FROM current_period cp, previous_period pp;

  -- Fatigue Edge Trends
  RETURN QUERY
  WITH current_period AS (
    SELECT 
      COUNT(*) FILTER (WHERE recommended_side_won IS NOT NULL) as verified,
      COUNT(*) FILTER (WHERE recommended_side_won = true) as correct
    FROM fatigue_edge_tracking
    WHERE created_at >= current_start
  ),
  previous_period AS (
    SELECT 
      COUNT(*) FILTER (WHERE recommended_side_won IS NOT NULL) as verified,
      COUNT(*) FILTER (WHERE recommended_side_won = true) as correct
    FROM fatigue_edge_tracking
    WHERE created_at >= previous_start AND created_at < previous_end
  )
  SELECT 
    'fatigue_edge'::text,
    CASE WHEN cp.verified > 0 THEN ROUND(cp.correct::numeric / cp.verified * 100, 1) ELSE 0 END,
    cp.verified::integer,
    CASE WHEN pp.verified > 0 THEN ROUND(pp.correct::numeric / pp.verified * 100, 1) ELSE 0 END,
    pp.verified::integer,
    CASE 
      WHEN cp.verified < 5 OR pp.verified < 5 THEN 'insufficient'
      WHEN CASE WHEN cp.verified > 0 THEN cp.correct::numeric / cp.verified ELSE 0 END > 
           CASE WHEN pp.verified > 0 THEN pp.correct::numeric / pp.verified ELSE 0 END + 0.02 THEN 'up'
      WHEN CASE WHEN cp.verified > 0 THEN cp.correct::numeric / cp.verified ELSE 0 END < 
           CASE WHEN pp.verified > 0 THEN pp.correct::numeric / pp.verified ELSE 0 END - 0.02 THEN 'down'
      ELSE 'stable'
    END,
    CASE WHEN cp.verified > 0 THEN ROUND(cp.correct::numeric / cp.verified * 100, 1) ELSE 0 END -
    CASE WHEN pp.verified > 0 THEN ROUND(pp.correct::numeric / pp.verified * 100, 1) ELSE 0 END
  FROM current_period cp, previous_period pp;

  -- Suggestions Trends
  RETURN QUERY
  WITH current_period AS (
    SELECT 
      COUNT(*) FILTER (WHERE sp.outcome IS NOT NULL) as verified,
      COUNT(*) FILTER (WHERE sp.outcome = true) as correct
    FROM suggestion_performance sp
    WHERE sp.created_at >= current_start
  ),
  previous_period AS (
    SELECT 
      COUNT(*) FILTER (WHERE sp.outcome IS NOT NULL) as verified,
      COUNT(*) FILTER (WHERE sp.outcome = true) as correct
    FROM suggestion_performance sp
    WHERE sp.created_at >= previous_start AND sp.created_at < previous_end
  )
  SELECT 
    'suggestions'::text,
    CASE WHEN cp.verified > 0 THEN ROUND(cp.correct::numeric / cp.verified * 100, 1) ELSE 0 END,
    cp.verified::integer,
    CASE WHEN pp.verified > 0 THEN ROUND(pp.correct::numeric / pp.verified * 100, 1) ELSE 0 END,
    pp.verified::integer,
    CASE 
      WHEN cp.verified < 5 OR pp.verified < 5 THEN 'insufficient'
      WHEN CASE WHEN cp.verified > 0 THEN cp.correct::numeric / cp.verified ELSE 0 END > 
           CASE WHEN pp.verified > 0 THEN pp.correct::numeric / pp.verified ELSE 0 END + 0.02 THEN 'up'
      WHEN CASE WHEN cp.verified > 0 THEN cp.correct::numeric / cp.verified ELSE 0 END < 
           CASE WHEN pp.verified > 0 THEN pp.correct::numeric / pp.verified ELSE 0 END - 0.02 THEN 'down'
      ELSE 'stable'
    END,
    CASE WHEN cp.verified > 0 THEN ROUND(cp.correct::numeric / cp.verified * 100, 1) ELSE 0 END -
    CASE WHEN pp.verified > 0 THEN ROUND(pp.correct::numeric / pp.verified * 100, 1) ELSE 0 END
  FROM current_period cp, previous_period pp;
END;
$$;