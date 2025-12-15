-- Create performance snapshots table for rolling metrics tracking
CREATE TABLE public.performance_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_name TEXT NOT NULL,
  sport TEXT,
  snapshot_date DATE NOT NULL,
  window_days INTEGER NOT NULL,
  
  -- Hit Rate Metrics
  total_predictions INTEGER DEFAULT 0,
  correct_predictions INTEGER DEFAULT 0,
  hit_rate NUMERIC(5,2),
  
  -- Calibration Metrics
  brier_score NUMERIC(6,4),
  log_loss NUMERIC(6,4),
  calibration_error NUMERIC(6,4),
  
  -- ROI Metrics
  total_staked NUMERIC(12,2) DEFAULT 0,
  total_profit NUMERIC(12,2) DEFAULT 0,
  roi_percentage NUMERIC(6,2),
  
  -- Sample Info
  sample_size INTEGER DEFAULT 0,
  confidence_level TEXT DEFAULT 'low',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(engine_name, sport, snapshot_date, window_days)
);

-- Enable RLS
ALTER TABLE public.performance_snapshots ENABLE ROW LEVEL SECURITY;

-- Anyone can view snapshots
CREATE POLICY "Anyone can view performance snapshots"
ON public.performance_snapshots FOR SELECT
USING (true);

-- Create index for efficient queries
CREATE INDEX idx_performance_snapshots_lookup 
ON public.performance_snapshots(engine_name, snapshot_date DESC, window_days);

CREATE INDEX idx_performance_snapshots_date_range
ON public.performance_snapshots(snapshot_date DESC, window_days);

-- Function to get rolling performance stats on-the-fly
CREATE OR REPLACE FUNCTION public.get_rolling_performance_stats(
  p_engine_name TEXT DEFAULT NULL,
  p_window_days INTEGER DEFAULT 14,
  p_sport TEXT DEFAULT NULL
)
RETURNS TABLE (
  engine_name TEXT,
  sport TEXT,
  window_days INTEGER,
  total_predictions BIGINT,
  correct_predictions BIGINT,
  hit_rate NUMERIC,
  avg_odds NUMERIC,
  roi_percentage NUMERIC,
  sample_confidence TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH hitrate_stats AS (
    SELECT 
      'hitrate_parlays' as engine,
      hp.sport,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE hp.outcome = 'won') as wins,
      AVG(hp.total_odds) as avg_odds
    FROM hitrate_parlays hp
    WHERE hp.settled_at >= NOW() - (p_window_days || ' days')::INTERVAL
      AND hp.outcome IN ('won', 'lost')
      AND (p_sport IS NULL OR hp.sport = p_sport)
    GROUP BY hp.sport
  ),
  juiced_stats AS (
    SELECT 
      'juiced_props' as engine,
      jp.sport,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE jp.outcome = 'won') as wins,
      AVG(jp.juice_amount) as avg_odds
    FROM juiced_props jp
    WHERE jp.verified_at >= NOW() - (p_window_days || ' days')::INTERVAL
      AND jp.outcome IN ('won', 'lost')
      AND (p_sport IS NULL OR jp.sport = p_sport)
    GROUP BY jp.sport
  ),
  sharp_stats AS (
    SELECT 
      'sharp_money' as engine,
      lm.sport,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE lm.outcome_correct = true) as wins,
      100::NUMERIC as avg_odds
    FROM line_movements lm
    WHERE lm.verified_at >= NOW() - (p_window_days || ' days')::INTERVAL
      AND lm.outcome_verified = true
      AND lm.is_primary_record = true
      AND (p_sport IS NULL OR lm.sport = p_sport)
    GROUP BY lm.sport
  ),
  combined AS (
    SELECT * FROM hitrate_stats
    UNION ALL
    SELECT * FROM juiced_stats
    UNION ALL
    SELECT * FROM sharp_stats
  )
  SELECT 
    c.engine::TEXT as engine_name,
    c.sport::TEXT,
    p_window_days as window_days,
    c.total as total_predictions,
    c.wins as correct_predictions,
    CASE WHEN c.total > 0 
      THEN ROUND(c.wins::NUMERIC / c.total * 100, 1) 
      ELSE 0 
    END as hit_rate,
    ROUND(COALESCE(c.avg_odds, 0), 0) as avg_odds,
    CASE WHEN c.total > 0 
      THEN ROUND((c.wins * 0.91 - (c.total - c.wins))::NUMERIC / c.total * 100, 1)
      ELSE 0
    END as roi_percentage,
    CASE 
      WHEN c.total >= 50 THEN 'high'
      WHEN c.total >= 20 THEN 'medium'
      WHEN c.total >= 10 THEN 'low'
      ELSE 'insufficient'
    END as sample_confidence
  FROM combined c
  WHERE (p_engine_name IS NULL OR c.engine = p_engine_name)
  ORDER BY c.total DESC;
END;
$$;