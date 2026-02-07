-- Add analysis_date column to sweet_spot_hedge_snapshots
ALTER TABLE sweet_spot_hedge_snapshots
  ADD COLUMN IF NOT EXISTS analysis_date date DEFAULT CURRENT_DATE;

-- Make sweet_spot_id nullable (drop NOT NULL constraint)
ALTER TABLE sweet_spot_hedge_snapshots
  ALTER COLUMN sweet_spot_id DROP NOT NULL;

-- Add composite index for efficient outcome matching
CREATE INDEX IF NOT EXISTS idx_hedge_snapshots_lookup 
  ON sweet_spot_hedge_snapshots(player_name, prop_type, line, analysis_date);

-- Create RPC for hedge status accuracy tracking
CREATE OR REPLACE FUNCTION get_hedge_status_accuracy_v2(
  start_date date DEFAULT CURRENT_DATE - INTERVAL '30 days',
  end_date date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  hedge_status text,
  quarter int,
  total_picks bigint,
  hits bigint,
  misses bigint,
  hit_rate numeric,
  avg_probability int,
  sample_confidence text
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.hedge_status,
    s.quarter,
    COUNT(*) as total_picks,
    COUNT(*) FILTER (WHERE c.outcome = 'hit') as hits,
    COUNT(*) FILTER (WHERE c.outcome = 'miss') as misses,
    ROUND(
      COUNT(*) FILTER (WHERE c.outcome = 'hit')::numeric / 
      NULLIF(COUNT(*) FILTER (WHERE c.outcome IN ('hit', 'miss')), 0) * 100, 1
    ) as hit_rate,
    AVG(s.hit_probability)::int as avg_probability,
    CASE 
      WHEN COUNT(*) >= 50 THEN 'HIGH'
      WHEN COUNT(*) >= 20 THEN 'MEDIUM'
      ELSE 'LOW'
    END as sample_confidence
  FROM sweet_spot_hedge_snapshots s
  LEFT JOIN category_sweet_spots c ON 
    LOWER(s.player_name) = LOWER(c.player_name) AND
    s.prop_type = c.prop_type AND
    ABS(s.line - COALESCE(c.actual_line, c.recommended_line)) < 0.5 AND
    s.analysis_date = c.analysis_date
  WHERE s.analysis_date BETWEEN start_date AND end_date
  GROUP BY s.hedge_status, s.quarter
  ORDER BY s.quarter, s.hedge_status;
END;
$$ LANGUAGE plpgsql;