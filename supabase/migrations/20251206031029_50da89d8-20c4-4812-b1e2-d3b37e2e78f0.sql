-- Create function to get unified accuracy stats across all systems
CREATE OR REPLACE FUNCTION public.get_unified_accuracy_stats()
RETURNS TABLE (
  category text,
  subcategory text,
  total_predictions integer,
  verified_predictions integer,
  correct_predictions integer,
  accuracy_rate numeric,
  sample_confidence text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Line Movements (Sharp Money) Stats
  RETURN QUERY
  SELECT 
    'sharp_money'::text as category,
    COALESCE(lm.recommendation, 'unknown')::text as subcategory,
    COUNT(*)::integer as total_predictions,
    COUNT(*) FILTER (WHERE lm.outcome_verified = true)::integer as verified_predictions,
    COUNT(*) FILTER (WHERE lm.outcome_correct = true)::integer as correct_predictions,
    CASE 
      WHEN COUNT(*) FILTER (WHERE lm.outcome_verified = true) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE lm.outcome_correct = true)::numeric / COUNT(*) FILTER (WHERE lm.outcome_verified = true) * 100, 1)
      ELSE 0
    END as accuracy_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE lm.outcome_verified = true) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE lm.outcome_verified = true) >= 50 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE lm.outcome_verified = true) >= 20 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM line_movements lm
  WHERE lm.is_primary_record = true
  GROUP BY lm.recommendation;

  -- Upset Predictions Stats
  RETURN QUERY
  SELECT 
    'upset_predictions'::text as category,
    up.confidence::text as subcategory,
    COUNT(*)::integer as total_predictions,
    COUNT(*) FILTER (WHERE up.game_completed = true)::integer as verified_predictions,
    COUNT(*) FILTER (WHERE up.was_upset = true)::integer as correct_predictions,
    CASE 
      WHEN COUNT(*) FILTER (WHERE up.game_completed = true) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE up.was_upset = true)::numeric / COUNT(*) FILTER (WHERE up.game_completed = true) * 100, 1)
      ELSE 0
    END as accuracy_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE up.game_completed = true) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE up.game_completed = true) >= 50 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE up.game_completed = true) >= 20 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM upset_predictions up
  GROUP BY up.confidence;

  -- AI Performance Metrics Stats
  RETURN QUERY
  SELECT 
    'ai_performance'::text as category,
    (apm.sport || ' - ' || apm.bet_type || ' (' || apm.confidence_level || ')')::text as subcategory,
    apm.total_predictions::integer as total_predictions,
    apm.total_predictions::integer as verified_predictions,
    apm.correct_predictions::integer as correct_predictions,
    apm.accuracy_rate as accuracy_rate,
    CASE 
      WHEN apm.total_predictions >= 100 THEN 'high'
      WHEN apm.total_predictions >= 50 THEN 'medium'
      WHEN apm.total_predictions >= 20 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM ai_performance_metrics apm
  WHERE apm.total_predictions >= 5;

  -- Fatigue Edge Tracking Stats
  RETURN QUERY
  SELECT 
    'fatigue_edge'::text as category,
    CASE 
      WHEN fet.fatigue_differential >= 30 THEN '30+ differential'
      WHEN fet.fatigue_differential >= 20 THEN '20-29 differential'
      ELSE '15-19 differential'
    END::text as subcategory,
    COUNT(*)::integer as total_predictions,
    COUNT(*) FILTER (WHERE fet.recommended_side_won IS NOT NULL)::integer as verified_predictions,
    COUNT(*) FILTER (WHERE fet.recommended_side_won = true)::integer as correct_predictions,
    CASE 
      WHEN COUNT(*) FILTER (WHERE fet.recommended_side_won IS NOT NULL) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE fet.recommended_side_won = true)::numeric / COUNT(*) FILTER (WHERE fet.recommended_side_won IS NOT NULL) * 100, 1)
      ELSE 0
    END as accuracy_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE fet.recommended_side_won IS NOT NULL) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE fet.recommended_side_won IS NOT NULL) >= 50 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE fet.recommended_side_won IS NOT NULL) >= 20 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM fatigue_edge_tracking fet
  WHERE fet.fatigue_differential >= 15
  GROUP BY CASE 
    WHEN fet.fatigue_differential >= 30 THEN '30+ differential'
    WHEN fet.fatigue_differential >= 20 THEN '20-29 differential'
    ELSE '15-19 differential'
  END;

  -- Trap Patterns Stats
  RETURN QUERY
  SELECT 
    'trap_patterns'::text as category,
    (tp.sport || ' - ' || tp.bet_type)::text as subcategory,
    COUNT(*)::integer as total_predictions,
    COUNT(*)::integer as verified_predictions,
    COUNT(*) FILTER (WHERE tp.confirmed_trap = true)::integer as correct_predictions,
    CASE 
      WHEN COUNT(*) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE tp.confirmed_trap = true)::numeric / COUNT(*) * 100, 1)
      ELSE 0
    END as accuracy_rate,
    CASE 
      WHEN COUNT(*) >= 100 THEN 'high'
      WHEN COUNT(*) >= 50 THEN 'medium'
      WHEN COUNT(*) >= 20 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM trap_patterns tp
  GROUP BY tp.sport, tp.bet_type;

  -- Suggestion Performance Stats
  RETURN QUERY
  SELECT 
    'suggestions'::text as category,
    sp_inner.sport::text as subcategory,
    COUNT(*)::integer as total_predictions,
    COUNT(*) FILTER (WHERE sp_perf.outcome IS NOT NULL)::integer as verified_predictions,
    COUNT(*) FILTER (WHERE sp_perf.outcome = true)::integer as correct_predictions,
    CASE 
      WHEN COUNT(*) FILTER (WHERE sp_perf.outcome IS NOT NULL) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE sp_perf.outcome = true)::numeric / COUNT(*) FILTER (WHERE sp_perf.outcome IS NOT NULL) * 100, 1)
      ELSE 0
    END as accuracy_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE sp_perf.outcome IS NOT NULL) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE sp_perf.outcome IS NOT NULL) >= 50 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE sp_perf.outcome IS NOT NULL) >= 20 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM suggestion_performance sp_perf
  JOIN suggested_parlays sp_inner ON sp_perf.suggested_parlay_id = sp_inner.id
  GROUP BY sp_inner.sport;
END;
$$;