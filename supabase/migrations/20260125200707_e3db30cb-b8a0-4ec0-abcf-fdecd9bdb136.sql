-- =============================================
-- SCOUT PROP OUTCOMES TABLE (for calibration)
-- =============================================

CREATE TABLE IF NOT EXISTS scout_prop_outcomes (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT now(),
  
  -- Game context
  event_id TEXT NOT NULL,
  espn_event_id TEXT,
  analysis_date DATE NOT NULL DEFAULT CURRENT_DATE,
  
  -- Player info
  player_name TEXT NOT NULL,
  team TEXT,
  
  -- Prop details
  prop TEXT NOT NULL,              -- 'Points'|'Rebounds'|'Assists'|'PRA'
  side TEXT NOT NULL,              -- 'OVER'|'UNDER'
  line NUMERIC NOT NULL,
  
  -- Prediction data
  predicted_final NUMERIC NOT NULL,
  confidence_raw INT NOT NULL,     -- 1..99
  minutes_remaining_est NUMERIC,
  rate_modifier NUMERIC,
  minutes_uncertainty NUMERIC,
  risk_flags JSONB DEFAULT '[]',
  rotation_role TEXT,
  on_court_stability NUMERIC,
  
  -- Outcome tracking
  actual_final NUMERIC,
  outcome TEXT DEFAULT 'pending', -- 'hit'|'miss'|'push'|'pending'
  settled_at TIMESTAMPTZ
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_scout_outcomes_date ON scout_prop_outcomes(analysis_date);
CREATE INDEX IF NOT EXISTS idx_scout_outcomes_player ON scout_prop_outcomes(player_name);
CREATE INDEX IF NOT EXISTS idx_scout_outcomes_event ON scout_prop_outcomes(event_id);
CREATE INDEX IF NOT EXISTS idx_scout_outcomes_outcome ON scout_prop_outcomes(outcome) WHERE outcome IN ('hit', 'miss');

-- =============================================
-- CALIBRATION VIEW (bucketed by 10s)
-- =============================================

CREATE OR REPLACE VIEW scout_confidence_calibration AS
SELECT
  (confidence_raw / 10) * 10 AS bucket,
  COUNT(*) FILTER (WHERE outcome IN ('hit','miss')) AS settled,
  AVG(CASE WHEN outcome = 'hit' THEN 1 ELSE 0 END) AS hit_rate,
  AVG(confidence_raw) AS avg_confidence_raw,
  AVG(ABS(actual_final - predicted_final)) AS mae
FROM scout_prop_outcomes
WHERE outcome IN ('hit','miss')
GROUP BY bucket
ORDER BY bucket;

-- =============================================
-- BUCKET MAP TABLE (for Platt/Isotonic calibration)
-- =============================================

CREATE TABLE IF NOT EXISTS scout_confidence_bucket_map (
  bucket INT PRIMARY KEY,          -- 10..90
  calibrated_prob NUMERIC NOT NULL, -- 0..1
  sample_size INT DEFAULT 0,
  last_hit_rate NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed initial buckets with naive 1:1 mapping
INSERT INTO scout_confidence_bucket_map (bucket, calibrated_prob)
VALUES 
  (10, 0.10), (20, 0.20), (30, 0.30), (40, 0.40), (50, 0.50),
  (60, 0.60), (70, 0.70), (80, 0.80), (90, 0.90)
ON CONFLICT (bucket) DO NOTHING;

-- =============================================
-- RLS POLICIES
-- =============================================

ALTER TABLE scout_prop_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scout_confidence_bucket_map ENABLE ROW LEVEL SECURITY;

-- Public read for calibration data
CREATE POLICY "Allow public read on scout_prop_outcomes"
ON scout_prop_outcomes FOR SELECT
USING (true);

CREATE POLICY "Allow public read on scout_confidence_bucket_map"
ON scout_confidence_bucket_map FOR SELECT
USING (true);

-- Allow inserts from edge functions (service role)
CREATE POLICY "Allow service inserts on scout_prop_outcomes"
ON scout_prop_outcomes FOR INSERT
WITH CHECK (true);

CREATE POLICY "Allow service updates on scout_prop_outcomes"
ON scout_prop_outcomes FOR UPDATE
USING (true);

CREATE POLICY "Allow service updates on scout_confidence_bucket_map"
ON scout_confidence_bucket_map FOR UPDATE
USING (true);