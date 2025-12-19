-- Add parlay_grade column to median_lock_candidates
ALTER TABLE public.median_lock_candidates 
ADD COLUMN IF NOT EXISTS parlay_grade boolean DEFAULT false;

-- Add index for faster parlay_grade queries
CREATE INDEX IF NOT EXISTS idx_median_lock_candidates_parlay_grade 
ON public.median_lock_candidates (parlay_grade) WHERE parlay_grade = true;

-- Update the accuracy stats function to include parlay-grade stats
CREATE OR REPLACE FUNCTION public.get_median_lock_accuracy_stats()
 RETURNS TABLE(category text, total_picks integer, verified_picks integer, hits integer, misses integer, hit_rate numeric, sample_confidence text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- PARLAY GRADE accuracy (65-70% target)
  RETURN QUERY
  SELECT 
    'PARLAY_GRADE'::TEXT as category,
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
  WHERE parlay_grade = true;

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
$function$;