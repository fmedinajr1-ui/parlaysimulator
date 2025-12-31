-- Add rank column to daily_elite_parlays for multi-parlay support
ALTER TABLE daily_elite_parlays 
ADD COLUMN IF NOT EXISTS rank integer DEFAULT 1;

COMMENT ON COLUMN daily_elite_parlays.rank IS 
'Ranking of parlay for the day (1=primary/best, 2-5=alternatives)';