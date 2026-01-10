-- Add verified_legs_count column to sharp_ai_parlays
ALTER TABLE sharp_ai_parlays 
ADD COLUMN IF NOT EXISTS verified_legs_count integer DEFAULT 0;

-- Add verified_legs_count column to heat_parlays
ALTER TABLE heat_parlays 
ADD COLUMN IF NOT EXISTS verified_legs_count integer DEFAULT 0;