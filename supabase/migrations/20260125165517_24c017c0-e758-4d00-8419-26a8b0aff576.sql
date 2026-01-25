-- Add projection columns to category_sweet_spots
ALTER TABLE category_sweet_spots
  ADD COLUMN IF NOT EXISTS projected_value numeric,
  ADD COLUMN IF NOT EXISTS projection_source text,
  ADD COLUMN IF NOT EXISTS matchup_adjustment numeric,
  ADD COLUMN IF NOT EXISTS pace_adjustment numeric;

-- Add index for mismatch queries
CREATE INDEX IF NOT EXISTS idx_css_projection_audit 
  ON category_sweet_spots (analysis_date DESC, projected_value)
  WHERE projected_value IS NOT NULL;

-- Create RPC for line mismatch accuracy analysis
CREATE OR REPLACE FUNCTION get_line_mismatch_accuracy(days_back int DEFAULT 30)
RETURNS TABLE (
  severity_tier text,
  total_picks bigint,
  hits bigint,
  misses bigint,
  hit_rate numeric,
  avg_line_diff numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN ABS(actual_line - recommended_line) >= 10 THEN 'EXTREME (10+)'
      WHEN ABS(actual_line - recommended_line) >= 5 THEN 'HIGH (5-10)'
      WHEN ABS(actual_line - recommended_line) >= 2 THEN 'MEDIUM (2-5)'
      ELSE 'LOW (0-2)'
    END as severity_tier,
    COUNT(*) FILTER (WHERE outcome IN ('hit','miss')) as total_picks,
    COUNT(*) FILTER (WHERE outcome = 'hit') as hits,
    COUNT(*) FILTER (WHERE outcome = 'miss') as misses,
    ROUND(AVG(CASE WHEN outcome = 'hit' THEN 1 WHEN outcome = 'miss' THEN 0 END)::numeric, 4) as hit_rate,
    ROUND(AVG(ABS(actual_line - recommended_line))::numeric, 2) as avg_line_diff
  FROM category_sweet_spots
  WHERE analysis_date >= current_date - days_back
    AND actual_line IS NOT NULL
    AND recommended_line IS NOT NULL
    AND outcome IN ('hit', 'miss')
  GROUP BY 1
  ORDER BY avg_line_diff DESC;
END;
$$ LANGUAGE plpgsql;

-- Create RPC for projection accuracy tracking
CREATE OR REPLACE FUNCTION get_projection_accuracy(days_back int DEFAULT 30)
RETURNS TABLE (
  prop_type text,
  total_picks bigint,
  avg_projection_error numeric,
  within_3_pct numeric,
  within_5_pct numeric,
  avg_edge numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    css.prop_type,
    COUNT(*) as total_picks,
    ROUND(AVG(ABS(actual_value - projected_value))::numeric, 2) as avg_projection_error,
    ROUND(COUNT(*) FILTER (WHERE ABS(actual_value - projected_value) <= 3)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as within_3_pct,
    ROUND(COUNT(*) FILTER (WHERE ABS(actual_value - projected_value) <= 5)::numeric / NULLIF(COUNT(*), 0) * 100, 1) as within_5_pct,
    ROUND(AVG(projected_value - actual_line)::numeric, 2) as avg_edge
  FROM category_sweet_spots css
  WHERE css.analysis_date >= current_date - days_back
    AND css.actual_value IS NOT NULL
    AND css.projected_value IS NOT NULL
  GROUP BY css.prop_type;
END;
$$ LANGUAGE plpgsql;