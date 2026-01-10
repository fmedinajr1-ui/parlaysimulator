-- Add Fade Mode columns to nba_risk_engine_picks
ALTER TABLE nba_risk_engine_picks 
ADD COLUMN IF NOT EXISTS is_fade_specialist boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS fade_edge_tag text;

-- Create index for fade specialist queries
CREATE INDEX IF NOT EXISTS idx_risk_engine_picks_fade_specialist 
ON nba_risk_engine_picks(is_fade_specialist, game_date) 
WHERE is_fade_specialist = true;

-- Add comment for documentation
COMMENT ON COLUMN nba_risk_engine_picks.is_fade_specialist IS 'True when pick matches high-edge Under patterns (WING rebounds, competitive games)';
COMMENT ON COLUMN nba_risk_engine_picks.fade_edge_tag IS 'Tag indicating fade edge type: FADE_ELITE, FADE_EDGE, FADE_COMBO, AST_FADE_RISK';