-- Matchup Scanner Accuracy Breakdown RPC
-- Returns accuracy metrics by category, grade, and side

CREATE OR REPLACE FUNCTION get_matchup_scanner_accuracy_breakdown(days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  category TEXT,
  grade TEXT,
  side TEXT,
  total_picks BIGINT,
  hits BIGINT,
  misses BIGINT,
  pushes BIGINT,
  hit_rate NUMERIC,
  avg_edge_score NUMERIC
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    css.category::TEXT,
    CASE 
      WHEN css.confidence_score >= 8 THEN 'A+'
      WHEN css.confidence_score >= 5 THEN 'A'
      WHEN css.confidence_score >= 2 THEN 'B+'
      ELSE 'B'
    END::TEXT as grade,
    COALESCE(css.recommended_side, 'over')::TEXT as side,
    COUNT(*)::BIGINT as total_picks,
    COUNT(*) FILTER (WHERE css.outcome = 'hit')::BIGINT as hits,
    COUNT(*) FILTER (WHERE css.outcome = 'miss')::BIGINT as misses,
    COUNT(*) FILTER (WHERE css.outcome = 'push')::BIGINT as pushes,
    ROUND(
      CASE 
        WHEN COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) > 0 
        THEN COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / 
             COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')) * 100
        ELSE 0
      END, 
      1
    ) as hit_rate,
    ROUND(COALESCE(AVG(css.confidence_score), 0), 2) as avg_edge_score
  FROM category_sweet_spots css
  WHERE css.category IN ('MATCHUP_SCANNER_PTS', 'MATCHUP_SCANNER_3PT')
    AND css.analysis_date >= CURRENT_DATE - days_back
    AND css.outcome IS NOT NULL
  GROUP BY 
    css.category,
    CASE 
      WHEN css.confidence_score >= 8 THEN 'A+'
      WHEN css.confidence_score >= 5 THEN 'A'
      WHEN css.confidence_score >= 2 THEN 'B+'
      ELSE 'B'
    END,
    COALESCE(css.recommended_side, 'over')
  ORDER BY css.category, grade, side;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_matchup_scanner_accuracy_breakdown(INTEGER) TO anon, authenticated;