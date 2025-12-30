-- Add outcome tracking columns to suggested_parlays
ALTER TABLE suggested_parlays 
  ADD COLUMN IF NOT EXISTS outcome TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS leg_outcomes JSONB DEFAULT '[]';

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_suggested_parlays_outcome ON suggested_parlays(outcome);
CREATE INDEX IF NOT EXISTS idx_suggested_parlays_settled_at ON suggested_parlays(settled_at);