-- Create unified system accuracy RPC function
CREATE OR REPLACE FUNCTION public.get_unified_system_accuracy(days_back integer DEFAULT 30)
RETURNS TABLE(
  system_name TEXT,
  display_name TEXT,
  icon TEXT,
  total_picks BIGINT,
  verified_picks BIGINT,
  hits BIGINT,
  misses BIGINT,
  pushes BIGINT,
  hit_rate NUMERIC,
  sample_confidence TEXT,
  last_updated TIMESTAMPTZ
)
LANGUAGE plpgsql
AS $function$
BEGIN
  -- 3PT Shooters (from category_sweet_spots where category = 'THREE_POINT_SHOOTER')
  RETURN QUERY
  SELECT 
    '3pt_shooters'::TEXT as system_name,
    '3PT Shooters'::TEXT as display_name,
    '🏀'::TEXT as icon,
    COUNT(*)::BIGINT as total_picks,
    COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss', 'push'))::BIGINT as verified_picks,
    COUNT(*) FILTER (WHERE css.outcome = 'hit')::BIGINT as hits,
    COUNT(*) FILTER (WHERE css.outcome = 'miss')::BIGINT as misses,
    COUNT(*) FILTER (WHERE css.outcome = 'push')::BIGINT as pushes,
    ROUND(
      COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / 
      NULLIF(COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')), 0) * 100, 
    1) as hit_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 50 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 20 THEN 'low'
      ELSE 'insufficient'
    END::TEXT as sample_confidence,
    MAX(css.settled_at) as last_updated
  FROM category_sweet_spots css
  WHERE css.category = 'THREE_POINT_SHOOTER'
    AND css.analysis_date >= current_date - days_back;

  -- Sweet Spots (All categories)
  RETURN QUERY
  SELECT 
    'sweet_spots'::TEXT as system_name,
    'Sweet Spots'::TEXT as display_name,
    '✨'::TEXT as icon,
    COUNT(*)::BIGINT as total_picks,
    COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss', 'push'))::BIGINT as verified_picks,
    COUNT(*) FILTER (WHERE css.outcome = 'hit')::BIGINT as hits,
    COUNT(*) FILTER (WHERE css.outcome = 'miss')::BIGINT as misses,
    COUNT(*) FILTER (WHERE css.outcome = 'push')::BIGINT as pushes,
    ROUND(
      COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / 
      NULLIF(COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')), 0) * 100, 
    1) as hit_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 50 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 20 THEN 'low'
      ELSE 'insufficient'
    END::TEXT as sample_confidence,
    MAX(css.settled_at) as last_updated
  FROM category_sweet_spots css
  WHERE css.analysis_date >= current_date - days_back;

  -- Whale Proxy
  RETURN QUERY
  SELECT 
    'whale_proxy'::TEXT as system_name,
    'Whale Proxy'::TEXT as display_name,
    '🐋'::TEXT as icon,
    COUNT(*)::BIGINT as total_picks,
    COUNT(*) FILTER (WHERE wp.outcome IN ('hit', 'miss', 'push'))::BIGINT as verified_picks,
    COUNT(*) FILTER (WHERE wp.outcome = 'hit')::BIGINT as hits,
    COUNT(*) FILTER (WHERE wp.outcome = 'miss')::BIGINT as misses,
    COUNT(*) FILTER (WHERE wp.outcome = 'push')::BIGINT as pushes,
    ROUND(
      COUNT(*) FILTER (WHERE wp.outcome = 'hit')::NUMERIC / 
      NULLIF(COUNT(*) FILTER (WHERE wp.outcome IN ('hit', 'miss')), 0) * 100, 
    1) as hit_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE wp.outcome IN ('hit', 'miss')) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE wp.outcome IN ('hit', 'miss')) >= 50 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE wp.outcome IN ('hit', 'miss')) >= 20 THEN 'low'
      ELSE 'insufficient'
    END::TEXT as sample_confidence,
    MAX(wp.settled_at) as last_updated
  FROM whale_picks wp
  WHERE wp.created_at >= current_date - days_back;

  -- Lock Mode (Scout predictions)
  RETURN QUERY
  SELECT 
    'lock_mode'::TEXT as system_name,
    'Lock Mode'::TEXT as display_name,
    '🔒'::TEXT as icon,
    COUNT(*)::BIGINT as total_picks,
    COUNT(*) FILTER (WHERE spo.outcome IN ('hit', 'miss', 'push'))::BIGINT as verified_picks,
    COUNT(*) FILTER (WHERE spo.outcome = 'hit')::BIGINT as hits,
    COUNT(*) FILTER (WHERE spo.outcome = 'miss')::BIGINT as misses,
    COUNT(*) FILTER (WHERE spo.outcome = 'push')::BIGINT as pushes,
    ROUND(
      COUNT(*) FILTER (WHERE spo.outcome = 'hit')::NUMERIC / 
      NULLIF(COUNT(*) FILTER (WHERE spo.outcome IN ('hit', 'miss')), 0) * 100, 
    1) as hit_rate,
    CASE 
      WHEN COUNT(*) FILTER (WHERE spo.outcome IN ('hit', 'miss')) >= 100 THEN 'high'
      WHEN COUNT(*) FILTER (WHERE spo.outcome IN ('hit', 'miss')) >= 50 THEN 'medium'
      WHEN COUNT(*) FILTER (WHERE spo.outcome IN ('hit', 'miss')) >= 20 THEN 'low'
      ELSE 'insufficient'
    END::TEXT as sample_confidence,
    MAX(spo.verified_at) as last_updated
  FROM scout_prop_outcomes spo
  WHERE spo.analysis_date >= current_date - days_back;
END;
$function$;