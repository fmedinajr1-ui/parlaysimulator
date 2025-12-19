-- Add columns for engine disable functionality
ALTER TABLE ai_formula_performance 
ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS disable_reason TEXT;