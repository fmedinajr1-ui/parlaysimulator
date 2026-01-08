-- Add columns to track odds freshness in unified_props
ALTER TABLE unified_props ADD COLUMN IF NOT EXISTS odds_updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE unified_props ADD COLUMN IF NOT EXISTS preferred_bookmaker TEXT;

-- Add index for freshness queries
CREATE INDEX IF NOT EXISTS idx_unified_props_odds_updated 
ON unified_props(odds_updated_at DESC);

-- Add odds freshness to risk engine picks
ALTER TABLE nba_risk_engine_picks ADD COLUMN IF NOT EXISTS current_line NUMERIC;
ALTER TABLE nba_risk_engine_picks ADD COLUMN IF NOT EXISTS over_price INTEGER;
ALTER TABLE nba_risk_engine_picks ADD COLUMN IF NOT EXISTS under_price INTEGER;
ALTER TABLE nba_risk_engine_picks ADD COLUMN IF NOT EXISTS bookmaker TEXT;
ALTER TABLE nba_risk_engine_picks ADD COLUMN IF NOT EXISTS odds_updated_at TIMESTAMPTZ;