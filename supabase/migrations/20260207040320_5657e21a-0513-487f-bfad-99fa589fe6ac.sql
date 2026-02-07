-- Add unique constraint for composite upsert key
-- This enables upsert on (player_name, prop_type, line, quarter, analysis_date)
CREATE UNIQUE INDEX IF NOT EXISTS idx_hedge_snapshots_composite_upsert 
  ON sweet_spot_hedge_snapshots(player_name, prop_type, line, quarter, analysis_date);