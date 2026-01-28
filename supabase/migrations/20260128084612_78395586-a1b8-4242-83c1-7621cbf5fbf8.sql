-- Add outcome tracking columns to whale_picks table
ALTER TABLE whale_picks ADD COLUMN IF NOT EXISTS outcome text DEFAULT 'pending';
ALTER TABLE whale_picks ADD COLUMN IF NOT EXISTS actual_value numeric;
ALTER TABLE whale_picks ADD COLUMN IF NOT EXISTS settled_at timestamp with time zone;
ALTER TABLE whale_picks ADD COLUMN IF NOT EXISTS verified_source text;

-- Add index for efficient querying of pending picks
CREATE INDEX IF NOT EXISTS idx_whale_picks_outcome ON whale_picks(outcome);
CREATE INDEX IF NOT EXISTS idx_whale_picks_start_time ON whale_picks(start_time);