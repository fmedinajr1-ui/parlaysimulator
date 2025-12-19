-- Add opponent-based stats columns to median_lock_candidates
ALTER TABLE median_lock_candidates 
  ADD COLUMN IF NOT EXISTS vs_opponent_games INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vs_opponent_hit_rate DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS vs_opponent_median DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS vs_opponent_avg DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS blended_hit_rate DECIMAL(5,4),
  ADD COLUMN IF NOT EXISTS blended_median DECIMAL(6,2),
  ADD COLUMN IF NOT EXISTS opponent_impact TEXT CHECK (opponent_impact IN ('BOOST', 'NEUTRAL', 'CAUTION', 'FADE'));

-- Add index for opponent queries
CREATE INDEX IF NOT EXISTS idx_median_lock_opponent_impact 
ON median_lock_candidates(opponent_impact) 
WHERE opponent_impact IS NOT NULL;