-- Add sharp alert columns to nba_risk_engine_picks
ALTER TABLE nba_risk_engine_picks
ADD COLUMN IF NOT EXISTS sharp_alert BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS sharp_alert_level TEXT,
ADD COLUMN IF NOT EXISTS sharp_movement_pts NUMERIC,
ADD COLUMN IF NOT EXISTS sharp_direction TEXT,
ADD COLUMN IF NOT EXISTS sharp_detected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_trap_indicator BOOLEAN DEFAULT FALSE;

-- Enable realtime for extreme_movement_alerts
ALTER PUBLICATION supabase_realtime ADD TABLE extreme_movement_alerts;

-- Index for quick alert lookups
CREATE INDEX IF NOT EXISTS idx_risk_picks_sharp_alert 
ON nba_risk_engine_picks(sharp_alert, game_date) 
WHERE sharp_alert = true;

-- Index for matching picks to movements
CREATE INDEX IF NOT EXISTS idx_risk_picks_player_prop 
ON nba_risk_engine_picks(player_name, prop_type, game_date);