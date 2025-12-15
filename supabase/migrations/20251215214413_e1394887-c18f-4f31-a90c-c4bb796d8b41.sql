-- Add bet_side column to median_lock_candidates table
ALTER TABLE median_lock_candidates 
ADD COLUMN IF NOT EXISTS bet_side TEXT CHECK (bet_side IN ('OVER', 'UNDER', 'PASS'));

-- Add index for filtering by bet_side
CREATE INDEX IF NOT EXISTS idx_median_lock_candidates_bet_side ON median_lock_candidates(bet_side);