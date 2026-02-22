
CREATE OR REPLACE FUNCTION get_hedge_side_performance(days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  side TEXT,
  quarter INTEGER,
  hedge_status TEXT,
  total_picks BIGINT,
  hits BIGINT,
  misses BIGINT,
  hit_rate NUMERIC,
  avg_projected_final NUMERIC,
  avg_gap_to_line NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(LOWER(s.side), 'over')::TEXT AS side,
    s.quarter,
    s.hedge_status,
    COUNT(*)::BIGINT AS total_picks,
    COUNT(*) FILTER (WHERE s.outcome = 'hit')::BIGINT AS hits,
    COUNT(*) FILTER (WHERE s.outcome = 'miss')::BIGINT AS misses,
    CASE 
      WHEN COUNT(*) FILTER (WHERE s.outcome IN ('hit', 'miss')) > 0 
      THEN ROUND(
        COUNT(*) FILTER (WHERE s.outcome = 'hit')::NUMERIC * 100.0 / 
        COUNT(*) FILTER (WHERE s.outcome IN ('hit', 'miss')),
        1
      )
      ELSE 0
    END AS hit_rate,
    ROUND(AVG(s.projected_final)::NUMERIC, 1) AS avg_projected_final,
    ROUND(AVG(s.projected_final - s.line)::NUMERIC, 2) AS avg_gap_to_line
  FROM sweet_spot_hedge_snapshots s
  WHERE s.outcome IS NOT NULL
    AND s.created_at >= NOW() - (days_back || ' days')::INTERVAL
  GROUP BY COALESCE(LOWER(s.side), 'over'), s.quarter, s.hedge_status
  ORDER BY side, s.quarter, s.hedge_status;
END;
$$;
