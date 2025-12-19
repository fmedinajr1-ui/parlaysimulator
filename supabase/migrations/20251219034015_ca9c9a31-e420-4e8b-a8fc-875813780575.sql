-- Create function to get MedianLock accuracy stats
CREATE OR REPLACE FUNCTION public.get_median_lock_accuracy_stats()
RETURNS TABLE (
  category TEXT,
  total_picks INTEGER,
  verified_picks INTEGER,
  hits INTEGER,
  misses INTEGER,
  hit_rate NUMERIC,
  sample_confidence TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Overall accuracy
  RETURN QUERY
  SELECT 
    'overall'::TEXT as category,
    COUNT(*)::INTEGER as total_picks,
    COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss'))::INTEGER as verified_picks,
    COUNT(*) FILTER (WHERE outcome = 'hit')::INTEGER as hits,
    COUNT(*) FILTER (WHERE outcome = 'miss')::INTEGER as misses,
    CASE 
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE outcome = 'hit')::NUMERIC / COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) * 100, 1)
      ELSE 0
    END as hit_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 30 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 10 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM median_lock_candidates
  WHERE classification IN ('LOCK', 'STRONG');

  -- LOCK accuracy
  RETURN QUERY
  SELECT 
    'LOCK'::TEXT as category,
    COUNT(*)::INTEGER as total_picks,
    COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss'))::INTEGER as verified_picks,
    COUNT(*) FILTER (WHERE outcome = 'hit')::INTEGER as hits,
    COUNT(*) FILTER (WHERE outcome = 'miss')::INTEGER as misses,
    CASE 
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE outcome = 'hit')::NUMERIC / COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) * 100, 1)
      ELSE 0
    END as hit_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 30 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 10 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM median_lock_candidates
  WHERE classification = 'LOCK';

  -- STRONG accuracy
  RETURN QUERY
  SELECT 
    'STRONG'::TEXT as category,
    COUNT(*)::INTEGER as total_picks,
    COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss'))::INTEGER as verified_picks,
    COUNT(*) FILTER (WHERE outcome = 'hit')::INTEGER as hits,
    COUNT(*) FILTER (WHERE outcome = 'miss')::INTEGER as misses,
    CASE 
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE outcome = 'hit')::NUMERIC / COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) * 100, 1)
      ELSE 0
    END as hit_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 30 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 10 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM median_lock_candidates
  WHERE classification = 'STRONG';

  -- OVER accuracy
  RETURN QUERY
  SELECT 
    'OVER'::TEXT as category,
    COUNT(*)::INTEGER as total_picks,
    COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss'))::INTEGER as verified_picks,
    COUNT(*) FILTER (WHERE outcome = 'hit')::INTEGER as hits,
    COUNT(*) FILTER (WHERE outcome = 'miss')::INTEGER as misses,
    CASE 
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE outcome = 'hit')::NUMERIC / COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) * 100, 1)
      ELSE 0
    END as hit_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 30 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 10 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM median_lock_candidates
  WHERE classification IN ('LOCK', 'STRONG')
    AND bet_side = 'OVER';

  -- UNDER accuracy
  RETURN QUERY
  SELECT 
    'UNDER'::TEXT as category,
    COUNT(*)::INTEGER as total_picks,
    COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss'))::INTEGER as verified_picks,
    COUNT(*) FILTER (WHERE outcome = 'hit')::INTEGER as hits,
    COUNT(*) FILTER (WHERE outcome = 'miss')::INTEGER as misses,
    CASE 
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) > 0 
      THEN ROUND(COUNT(*) FILTER (WHERE outcome = 'hit')::NUMERIC / COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) * 100, 1)
      ELSE 0
    END as hit_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 30 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE outcome IN ('hit', 'miss')) >= 10 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM median_lock_candidates
  WHERE classification IN ('LOCK', 'STRONG')
    AND bet_side = 'UNDER';
END;
$$;