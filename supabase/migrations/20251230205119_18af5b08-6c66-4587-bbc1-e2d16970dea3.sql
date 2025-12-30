-- Add matchup_data and parlay_strategy columns to suggested_parlays
ALTER TABLE suggested_parlays
ADD COLUMN IF NOT EXISTS matchup_data jsonb DEFAULT '[]',
ADD COLUMN IF NOT EXISTS parlay_strategy text;