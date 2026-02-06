CREATE OR REPLACE FUNCTION get_side_performance_tracking(
  days_back INTEGER DEFAULT 30
)
RETURNS TABLE(
  week_start DATE,
  side TEXT,
  hits INTEGER,
  misses INTEGER,
  total_picks INTEGER,
  hit_rate NUMERIC,
  avg_ceiling_protection NUMERIC,
  avg_l10_hit_rate NUMERIC
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    DATE_TRUNC('week', css.analysis_date::timestamp)::date as week_start,
    css.recommended_side as side,
    COUNT(*) FILTER (WHERE css.outcome = 'hit')::integer as hits,
    COUNT(*) FILTER (WHERE css.outcome = 'miss')::integer as misses,
    COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss'))::integer as total_picks,
    ROUND(
      COUNT(*) FILTER (WHERE css.outcome = 'hit')::numeric / 
      NULLIF(COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')), 0) * 100, 
      1
    ) as hit_rate,
    ROUND(AVG(
      CASE WHEN css.recommended_side = 'under' 
           THEN css.recommended_line / NULLIF(css.l10_max, 0)
           ELSE NULL 
      END
    )::numeric * 100, 1) as avg_ceiling_protection,
    ROUND(AVG(css.l10_hit_rate)::numeric * 100, 1) as avg_l10_hit_rate
  FROM category_sweet_spots css
  WHERE css.outcome IN ('hit', 'miss')
    AND css.recommended_side IS NOT NULL
    AND css.analysis_date >= CURRENT_DATE - (days_back || ' days')::interval
  GROUP BY week_start, side
  ORDER BY week_start DESC, side;
END;
$$;