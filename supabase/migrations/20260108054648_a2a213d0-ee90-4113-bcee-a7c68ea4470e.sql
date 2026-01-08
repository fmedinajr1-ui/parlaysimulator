-- Add missing columns for PRA and Ball Dominant tracking
ALTER TABLE nba_risk_engine_picks 
ADD COLUMN IF NOT EXISTS is_pra BOOLEAN DEFAULT FALSE;

ALTER TABLE nba_risk_engine_picks 
ADD COLUMN IF NOT EXISTS is_ball_dominant BOOLEAN DEFAULT FALSE;

-- Add index for quick filtering of PRA plays
CREATE INDEX IF NOT EXISTS idx_risk_picks_is_pra 
ON nba_risk_engine_picks(is_pra) WHERE is_pra = true;