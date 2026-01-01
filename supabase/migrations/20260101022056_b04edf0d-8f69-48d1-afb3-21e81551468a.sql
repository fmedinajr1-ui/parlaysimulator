-- Drop the broken unique constraint that only allows 1 parlay per date
ALTER TABLE daily_elite_parlays 
DROP CONSTRAINT IF EXISTS daily_elite_parlays_parlay_date_key;

-- Add composite unique constraint: (parlay_date, rank, leg_count)
-- This allows multiple parlays per date with different ranks/leg counts
ALTER TABLE daily_elite_parlays 
ADD CONSTRAINT daily_elite_parlays_date_rank_legs_unique 
UNIQUE (parlay_date, rank, leg_count);