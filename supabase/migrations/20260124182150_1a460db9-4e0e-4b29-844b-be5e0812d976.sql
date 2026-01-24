-- Add outcome tracking columns to category_sweet_spots
ALTER TABLE category_sweet_spots
  ADD COLUMN IF NOT EXISTS actual_value numeric,
  ADD COLUMN IF NOT EXISTS outcome text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_source text,
  ADD COLUMN IF NOT EXISTS engine_version text;

-- Performance indices for verification queries
CREATE INDEX IF NOT EXISTS idx_css_date_outcome 
  ON category_sweet_spots (analysis_date, outcome);
  
CREATE INDEX IF NOT EXISTS idx_css_pending 
  ON category_sweet_spots (analysis_date) WHERE outcome = 'pending';

-- Accuracy analytics function by category
CREATE OR REPLACE FUNCTION get_sweet_spot_accuracy(days_back int DEFAULT 30)
RETURNS TABLE (
  category text,
  total_picks bigint,
  hits bigint,
  misses bigint,
  pushes bigint,
  hit_rate numeric,
  no_push_hit_rate numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    css.category,
    COUNT(*) FILTER (WHERE css.outcome IN ('hit','miss','push')) as total_picks,
    COUNT(*) FILTER (WHERE css.outcome = 'hit') as hits,
    COUNT(*) FILTER (WHERE css.outcome = 'miss') as misses,
    COUNT(*) FILTER (WHERE css.outcome = 'push') as pushes,
    ROUND(AVG(CASE WHEN css.outcome = 'hit' THEN 1 WHEN css.outcome = 'miss' THEN 0 END)::numeric, 4) as hit_rate,
    ROUND(
      (COUNT(*) FILTER (WHERE css.outcome = 'hit'))::numeric / 
      NULLIF(COUNT(*) FILTER (WHERE css.outcome IN ('hit','miss')), 0), 
      4
    ) as no_push_hit_rate
  FROM category_sweet_spots css
  WHERE css.analysis_date >= current_date - days_back
    AND css.outcome IN ('hit', 'miss', 'push')
  GROUP BY css.category;
END;
$$ LANGUAGE plpgsql;

-- Accuracy by L10 bucket
CREATE OR REPLACE FUNCTION get_sweet_spot_accuracy_by_l10(days_back int DEFAULT 30)
RETURNS TABLE (
  l10_bucket text,
  total_picks bigint,
  hits bigint,
  hit_rate numeric,
  avg_l10 numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN css.l10_hit_rate >= 0.90 THEN '90-100%'
      WHEN css.l10_hit_rate >= 0.80 THEN '80-90%'
      WHEN css.l10_hit_rate >= 0.70 THEN '70-80%'
      ELSE '< 70%'
    END as l10_bucket,
    COUNT(*) FILTER (WHERE css.outcome IN ('hit','miss')) as total_picks,
    COUNT(*) FILTER (WHERE css.outcome = 'hit') as hits,
    ROUND(AVG(CASE WHEN css.outcome = 'hit' THEN 1 WHEN css.outcome = 'miss' THEN 0 END)::numeric, 4) as hit_rate,
    ROUND(AVG(css.l10_hit_rate)::numeric, 4) as avg_l10
  FROM category_sweet_spots css
  WHERE css.analysis_date >= current_date - days_back
    AND css.outcome IN ('hit', 'miss')
    AND css.l10_hit_rate IS NOT NULL
  GROUP BY 1
  ORDER BY avg_l10 DESC;
END;
$$ LANGUAGE plpgsql;

-- Accuracy by confidence bucket
CREATE OR REPLACE FUNCTION get_sweet_spot_accuracy_by_confidence(days_back int DEFAULT 30)
RETURNS TABLE (
  confidence_bucket text,
  total_picks bigint,
  hits bigint,
  hit_rate numeric,
  avg_confidence numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN css.confidence_score >= 9.5 THEN '9.5+'
      WHEN css.confidence_score >= 9.0 THEN '9.0-9.5'
      WHEN css.confidence_score >= 8.5 THEN '8.5-9.0'
      ELSE '< 8.5'
    END as confidence_bucket,
    COUNT(*) FILTER (WHERE css.outcome IN ('hit','miss')) as total_picks,
    COUNT(*) FILTER (WHERE css.outcome = 'hit') as hits,
    ROUND(AVG(CASE WHEN css.outcome = 'hit' THEN 1 WHEN css.outcome = 'miss' THEN 0 END)::numeric, 4) as hit_rate,
    ROUND(AVG(css.confidence_score)::numeric, 4) as avg_confidence
  FROM category_sweet_spots css
  WHERE css.analysis_date >= current_date - days_back
    AND css.outcome IN ('hit', 'miss')
    AND css.confidence_score IS NOT NULL
  GROUP BY 1
  ORDER BY avg_confidence DESC;
END;
$$ LANGUAGE plpgsql;