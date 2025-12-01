-- Add hybrid tracking columns to suggested_parlays table
ALTER TABLE suggested_parlays 
ADD COLUMN IF NOT EXISTS is_hybrid BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS hybrid_scores JSONB;

COMMENT ON COLUMN suggested_parlays.is_hybrid IS 'Whether this parlay was generated using the hybrid formula combining sharp data + user patterns + AI accuracy';
COMMENT ON COLUMN suggested_parlays.hybrid_scores IS 'Detailed breakdown of hybrid scores for each leg (sharp, user pattern, AI data)';