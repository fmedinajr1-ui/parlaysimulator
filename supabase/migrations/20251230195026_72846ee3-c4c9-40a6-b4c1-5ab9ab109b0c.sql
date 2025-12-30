-- Add verdict columns to suggested_parlays
ALTER TABLE suggested_parlays 
ADD COLUMN IF NOT EXISTS verdict text CHECK (verdict IN ('strong_pick', 'lean_pick', 'hold', 'lean_fade', 'strong_fade')),
ADD COLUMN IF NOT EXISTS verdict_signals jsonb DEFAULT '[]',
ADD COLUMN IF NOT EXISTS verdict_score numeric,
ADD COLUMN IF NOT EXISTS verdict_updated_at timestamptz;

-- Add validation columns to ai_generated_parlays
ALTER TABLE ai_generated_parlays
ADD COLUMN IF NOT EXISTS cross_validated boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS validation_signals jsonb DEFAULT '[]';