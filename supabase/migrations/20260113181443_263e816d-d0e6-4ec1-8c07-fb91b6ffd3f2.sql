-- Add missing columns for sweet spot tracking in nba_risk_engine_picks
ALTER TABLE nba_risk_engine_picks 
ADD COLUMN IF NOT EXISTS original_confidence NUMERIC,
ADD COLUMN IF NOT EXISTS is_sweet_spot BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS sweet_spot_reason TEXT;

-- Index for efficient sweet spot queries
CREATE INDEX IF NOT EXISTS idx_risk_engine_sweet_spot 
ON nba_risk_engine_picks(is_sweet_spot) WHERE is_sweet_spot = TRUE;