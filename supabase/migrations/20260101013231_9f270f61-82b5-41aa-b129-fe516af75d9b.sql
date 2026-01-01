-- Add leg_count column to support 2-leg parlays
ALTER TABLE daily_elite_parlays 
ADD COLUMN IF NOT EXISTS leg_count integer DEFAULT 3;

COMMENT ON COLUMN daily_elite_parlays.leg_count IS 
'Number of legs in parlay (2 or 3)';