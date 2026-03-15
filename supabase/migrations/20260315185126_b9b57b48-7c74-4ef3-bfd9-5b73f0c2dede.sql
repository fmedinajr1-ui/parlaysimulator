
-- Drop the old constraint that only covers sweet_spot_id + quarter
ALTER TABLE sweet_spot_hedge_snapshots DROP CONSTRAINT IF EXISTS unique_spot_quarter;

-- Add a new unique constraint matching the upsert's onConflict columns
ALTER TABLE sweet_spot_hedge_snapshots 
  ADD CONSTRAINT unique_snapshot_composite 
  UNIQUE (player_name, prop_type, line, quarter, analysis_date);
