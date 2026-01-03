-- Add experiment tracking columns to median_parlay_picks
ALTER TABLE median_parlay_picks 
ADD COLUMN IF NOT EXISTS experiment_id UUID REFERENCES parlay_ab_experiments(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS experiment_variant TEXT CHECK (experiment_variant IN ('control', 'variant', NULL));

-- Create index for experiment queries
CREATE INDEX IF NOT EXISTS idx_median_parlay_picks_experiment ON median_parlay_picks(experiment_id);