CREATE OR REPLACE FUNCTION public.get_unified_system_accuracy(days_back integer DEFAULT 30)
RETURNS TABLE(system_name text, display_name text, icon text, total_picks bigint, verified_picks bigint, hits bigint, misses bigint, pushes bigint, hit_rate numeric, sample_confidence text, last_updated timestamp with time zone)
LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    '3pt_shooters'::TEXT, '3PT Shooters'::TEXT, '🏀'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss', 'push'))::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome = 'hit')::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome = 'miss')::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome = 'push')::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')), 0) * 100, 1),
    CASE WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 100 THEN 'high' WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 50 THEN 'medium' WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 20 THEN 'low' ELSE 'insufficient' END::TEXT,
    MAX(css.settled_at)
  FROM category_sweet_spots css
  WHERE css.category = 'THREE_POINT_SHOOTER' AND css.analysis_date >= current_date - days_back;

  RETURN QUERY
  SELECT
    'sweet_spots'::TEXT, 'Sweet Spots'::TEXT, '✨'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss', 'push'))::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome = 'hit')::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome = 'miss')::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome = 'push')::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')), 0) * 100, 1),
    CASE WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 100 THEN 'high' WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 50 THEN 'medium' WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 20 THEN 'low' ELSE 'insufficient' END::TEXT,
    MAX(css.settled_at)
  FROM category_sweet_spots css
  WHERE css.category != 'THREE_POINT_SHOOTER' AND css.category NOT LIKE 'MATCHUP_SCANNER%' AND css.analysis_date >= current_date - days_back;

  RETURN QUERY
  SELECT
    'matchup_scanner'::TEXT, 'Matchup Scanner'::TEXT, '🎯'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss', 'push'))::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome = 'hit')::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome = 'miss')::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome = 'push')::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')), 0) * 100, 1),
    CASE WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 100 THEN 'high' WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 50 THEN 'medium' WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 20 THEN 'low' ELSE 'insufficient' END::TEXT,
    MAX(css.settled_at)
  FROM category_sweet_spots css
  WHERE css.category LIKE 'MATCHUP_SCANNER%' AND css.analysis_date >= current_date - days_back;

  RETURN QUERY
  SELECT
    'matchup_scanner_3pt'::TEXT, 'Matchup Scanner (3PT)'::TEXT, '🎯'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss', 'push'))::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome = 'hit')::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome = 'miss')::BIGINT,
    COUNT(*) FILTER (WHERE css.outcome = 'push')::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')), 0) * 100, 1),
    CASE WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 100 THEN 'high' WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 50 THEN 'medium' WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) >= 20 THEN 'low' ELSE 'insufficient' END::TEXT,
    MAX(css.settled_at)
  FROM category_sweet_spots css
  WHERE css.category = 'MATCHUP_SCANNER_3PT' AND css.analysis_date >= current_date - days_back;

  -- FanDuel Line Predictions
  RETURN QUERY
  SELECT
    'fanduel_lines'::TEXT, 'FanDuel Line Predictions'::TEXT, '📡'::TEXT,
    COUNT(*)::BIGINT,
    COUNT(*) FILTER (WHERE fpa.was_correct IS NOT NULL)::BIGINT,
    COUNT(*) FILTER (WHERE fpa.was_correct = true)::BIGINT,
    COUNT(*) FILTER (WHERE fpa.was_correct = false)::BIGINT,
    0::BIGINT,
    ROUND(COUNT(*) FILTER (WHERE fpa.was_correct = true)::NUMERIC / NULLIF(COUNT(*) FILTER (WHERE fpa.was_correct IS NOT NULL), 0) * 100, 1),
    CASE WHEN COUNT(*) FILTER (WHERE fpa.was_correct IS NOT NULL) >= 100 THEN 'high' WHEN COUNT(*) FILTER (WHERE fpa.was_correct IS NOT NULL) >= 50 THEN 'medium' WHEN COUNT(*) FILTER (WHERE fpa.was_correct IS NOT NULL) >= 20 THEN 'low' ELSE 'insufficient' END::TEXT,
    MAX(fpa.verified_at)
  FROM fanduel_prediction_accuracy fpa
  WHERE fpa.signal_type != 'trap_warning' AND fpa.created_at >= current_date - days_back;

END;
$function$;