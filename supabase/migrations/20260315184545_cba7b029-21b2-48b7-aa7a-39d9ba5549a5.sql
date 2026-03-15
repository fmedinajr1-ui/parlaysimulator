
CREATE OR REPLACE FUNCTION get_hedge_accuracy_with_alt_lines(days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  side TEXT,
  quarter INTEGER,
  hedge_status TEXT,
  total_picks BIGINT,
  hits_original BIGINT,
  misses_original BIGINT,
  hit_rate_original NUMERIC,
  hits_at_live_line BIGINT,
  misses_at_live_line BIGINT,
  hit_rate_at_live_line NUMERIC,
  avg_projected_final NUMERIC,
  avg_gap_to_line NUMERIC,
  avg_live_book_line NUMERIC,
  avg_line_movement NUMERIC
)
LANGUAGE sql STABLE
AS $$
  SELECT
    s.side::TEXT,
    s.quarter,
    s.hedge_status::TEXT,
    COUNT(*)::BIGINT AS total_picks,
    -- Original line accuracy
    COUNT(*) FILTER (WHERE s.outcome = 'hit')::BIGINT AS hits_original,
    COUNT(*) FILTER (WHERE s.outcome = 'miss')::BIGINT AS misses_original,
    ROUND(
      COUNT(*) FILTER (WHERE s.outcome = 'hit')::NUMERIC /
      NULLIF(COUNT(*), 0) * 100, 1
    ) AS hit_rate_original,
    -- Live line accuracy: would the actual final have hit the live book line?
    COUNT(*) FILTER (WHERE
      s.live_book_line IS NOT NULL
      AND s.actual_final IS NOT NULL
      AND (
        (LOWER(s.side) = 'over' AND s.actual_final > s.live_book_line)
        OR (LOWER(s.side) = 'under' AND s.actual_final < s.live_book_line)
      )
    )::BIGINT AS hits_at_live_line,
    COUNT(*) FILTER (WHERE
      s.live_book_line IS NOT NULL
      AND s.actual_final IS NOT NULL
      AND NOT (
        (LOWER(s.side) = 'over' AND s.actual_final > s.live_book_line)
        OR (LOWER(s.side) = 'under' AND s.actual_final < s.live_book_line)
      )
    )::BIGINT AS misses_at_live_line,
    ROUND(
      COUNT(*) FILTER (WHERE
        s.live_book_line IS NOT NULL
        AND s.actual_final IS NOT NULL
        AND (
          (LOWER(s.side) = 'over' AND s.actual_final > s.live_book_line)
          OR (LOWER(s.side) = 'under' AND s.actual_final < s.live_book_line)
        )
      )::NUMERIC /
      NULLIF(COUNT(*) FILTER (WHERE s.live_book_line IS NOT NULL AND s.actual_final IS NOT NULL), 0) * 100, 1
    ) AS hit_rate_at_live_line,
    ROUND(AVG(s.projected_final)::NUMERIC, 2) AS avg_projected_final,
    ROUND(AVG(s.gap_to_line)::NUMERIC, 2) AS avg_gap_to_line,
    ROUND(AVG(s.live_book_line)::NUMERIC, 2) AS avg_live_book_line,
    ROUND(AVG(s.line_movement)::NUMERIC, 2) AS avg_line_movement
  FROM sweet_spot_hedge_snapshots s
  WHERE s.outcome IS NOT NULL
    AND s.captured_at >= NOW() - (days_back || ' days')::INTERVAL
  GROUP BY s.side, s.quarter, s.hedge_status
  ORDER BY s.side, s.quarter, s.hedge_status;
$$;
