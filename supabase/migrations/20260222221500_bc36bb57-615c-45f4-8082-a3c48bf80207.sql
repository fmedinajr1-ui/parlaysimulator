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
LANGUAGE sql STABLE
AS $$
  SELECT
    s.side::TEXT,
    s.quarter,
    s.hedge_status::TEXT,
    COUNT(*)::BIGINT AS total_picks,
    COUNT(*) FILTER (WHERE s.outcome = 'hit')::BIGINT AS hits,
    COUNT(*) FILTER (WHERE s.outcome = 'miss')::BIGINT AS misses,
    ROUND(
      COUNT(*) FILTER (WHERE s.outcome = 'hit')::NUMERIC /
      NULLIF(COUNT(*), 0) * 100, 1
    ) AS hit_rate,
    ROUND(AVG(s.projected_final)::NUMERIC, 2) AS avg_projected_final,
    ROUND(AVG(s.gap_to_line)::NUMERIC, 2) AS avg_gap_to_line
  FROM sweet_spot_hedge_snapshots s
  WHERE s.outcome IS NOT NULL
    AND s.captured_at >= NOW() - (days_back || ' days')::INTERVAL
  GROUP BY s.side, s.quarter, s.hedge_status
  ORDER BY s.side, s.quarter, s.hedge_status;
$$;