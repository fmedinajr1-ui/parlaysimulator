-- Add alt line and juice detection columns to nba_risk_engine_picks
ALTER TABLE nba_risk_engine_picks 
ADD COLUMN IF NOT EXISTS alt_line_recommendation NUMERIC,
ADD COLUMN IF NOT EXISTS alt_line_reason TEXT,
ADD COLUMN IF NOT EXISTS is_juiced BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS juice_magnitude INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS line_warning TEXT;

-- Add archetype to prop_results_archive for historical analysis
ALTER TABLE prop_results_archive
ADD COLUMN IF NOT EXISTS archetype TEXT;