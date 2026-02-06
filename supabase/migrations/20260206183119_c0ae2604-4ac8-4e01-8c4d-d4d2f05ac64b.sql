-- Create table for tracking hedge status at quarter boundaries
CREATE TABLE public.sweet_spot_hedge_snapshots (
  id BIGSERIAL PRIMARY KEY,
  
  -- Link to Sweet Spot pick
  sweet_spot_id UUID REFERENCES category_sweet_spots(id) ON DELETE CASCADE,
  player_name TEXT NOT NULL,
  prop_type TEXT NOT NULL,
  line NUMERIC NOT NULL,
  side TEXT NOT NULL,
  
  -- Snapshot timing
  quarter INTEGER NOT NULL CHECK (quarter BETWEEN 1 AND 4),
  game_progress NUMERIC NOT NULL,
  
  -- Hedge status at this moment
  hedge_status TEXT NOT NULL,
  hit_probability INTEGER NOT NULL CHECK (hit_probability BETWEEN 0 AND 100),
  
  -- Production data
  current_value NUMERIC NOT NULL,
  projected_final NUMERIC NOT NULL,
  rate_per_minute NUMERIC,
  rate_needed NUMERIC,
  gap_to_line NUMERIC,
  
  -- Context factors
  pace_rating NUMERIC,
  zone_matchup_score NUMERIC,
  rotation_tier TEXT,
  risk_flags TEXT[],
  
  -- Live line tracking
  live_book_line NUMERIC,
  line_movement NUMERIC,
  
  -- Timestamps
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Ensure one snapshot per pick per quarter
  CONSTRAINT unique_spot_quarter UNIQUE (sweet_spot_id, quarter)
);

-- Indexes for analytics
CREATE INDEX idx_hedge_snapshots_status ON sweet_spot_hedge_snapshots (hedge_status, quarter);
CREATE INDEX idx_hedge_snapshots_outcome ON sweet_spot_hedge_snapshots (sweet_spot_id);
CREATE INDEX idx_hedge_snapshots_captured ON sweet_spot_hedge_snapshots (captured_at);

-- Enable RLS
ALTER TABLE public.sweet_spot_hedge_snapshots ENABLE ROW LEVEL SECURITY;

-- Public read access for analytics
CREATE POLICY "Public read access for hedge snapshots"
ON public.sweet_spot_hedge_snapshots
FOR SELECT
USING (true);

-- Service role insert (edge function will insert)
CREATE POLICY "Service role insert for hedge snapshots"
ON public.sweet_spot_hedge_snapshots
FOR INSERT
WITH CHECK (true);

-- Analytics function: Hit rate by hedge status at each quarter
CREATE OR REPLACE FUNCTION get_hedge_status_accuracy(days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  quarter INTEGER,
  hedge_status TEXT,
  total_picks BIGINT,
  hits BIGINT,
  misses BIGINT,
  hit_rate NUMERIC,
  avg_hit_probability NUMERIC
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    hs.quarter,
    hs.hedge_status,
    COUNT(*) as total_picks,
    COUNT(*) FILTER (WHERE css.outcome = 'hit') as hits,
    COUNT(*) FILTER (WHERE css.outcome = 'miss') as misses,
    ROUND(
      COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / 
      NULLIF(COUNT(*) FILTER (WHERE css.outcome IN ('hit', 'miss')), 0) * 100, 
      1
    ) as hit_rate,
    ROUND(AVG(hs.hit_probability), 1) as avg_hit_probability
  FROM sweet_spot_hedge_snapshots hs
  JOIN category_sweet_spots css ON hs.sweet_spot_id = css.id
  WHERE css.analysis_date >= current_date - days_back
    AND css.outcome IN ('hit', 'miss')
  GROUP BY hs.quarter, hs.hedge_status
  ORDER BY hs.quarter, 
    CASE hs.hedge_status 
      WHEN 'on_track' THEN 1
      WHEN 'monitor' THEN 2
      WHEN 'alert' THEN 3
      WHEN 'urgent' THEN 4
      WHEN 'profit_lock' THEN 5
    END;
END;
$$;

-- Calibration function: Probability vs Reality
CREATE OR REPLACE FUNCTION get_hedge_probability_calibration(days_back INTEGER DEFAULT 30)
RETURNS TABLE (
  probability_bucket TEXT,
  quarter INTEGER,
  total_picks BIGINT,
  hits BIGINT,
  actual_hit_rate NUMERIC,
  expected_hit_rate NUMERIC,
  calibration_error NUMERIC
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN hs.hit_probability >= 80 THEN '80-100%'
      WHEN hs.hit_probability >= 60 THEN '60-80%'
      WHEN hs.hit_probability >= 40 THEN '40-60%'
      WHEN hs.hit_probability >= 20 THEN '20-40%'
      ELSE '0-20%'
    END as probability_bucket,
    hs.quarter,
    COUNT(*) as total_picks,
    COUNT(*) FILTER (WHERE css.outcome = 'hit') as hits,
    ROUND(
      COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / 
      NULLIF(COUNT(*), 0) * 100, 
      1
    ) as actual_hit_rate,
    ROUND(AVG(hs.hit_probability), 1) as expected_hit_rate,
    ROUND(
      ABS(
        COUNT(*) FILTER (WHERE css.outcome = 'hit')::NUMERIC / NULLIF(COUNT(*), 0) * 100 - 
        AVG(hs.hit_probability)
      ), 
      1
    ) as calibration_error
  FROM sweet_spot_hedge_snapshots hs
  JOIN category_sweet_spots css ON hs.sweet_spot_id = css.id
  WHERE css.analysis_date >= current_date - days_back
    AND css.outcome IN ('hit', 'miss')
  GROUP BY 
    CASE 
      WHEN hs.hit_probability >= 80 THEN '80-100%'
      WHEN hs.hit_probability >= 60 THEN '60-80%'
      WHEN hs.hit_probability >= 40 THEN '40-60%'
      WHEN hs.hit_probability >= 20 THEN '20-40%'
      ELSE '0-20%'
    END,
    hs.quarter
  ORDER BY hs.quarter, probability_bucket DESC;
END;
$$;