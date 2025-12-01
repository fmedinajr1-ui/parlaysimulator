-- Add classification columns to line_movements table
ALTER TABLE public.line_movements 
ADD COLUMN IF NOT EXISTS movement_authenticity TEXT DEFAULT 'uncertain',
ADD COLUMN IF NOT EXISTS authenticity_confidence NUMERIC DEFAULT 0.5,
ADD COLUMN IF NOT EXISTS recommendation TEXT DEFAULT 'caution',
ADD COLUMN IF NOT EXISTS recommendation_reason TEXT,
ADD COLUMN IF NOT EXISTS opposite_side_moved BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS books_consensus INTEGER DEFAULT 1;

-- Add index for filtering by authenticity and recommendation
CREATE INDEX IF NOT EXISTS idx_line_movements_authenticity ON public.line_movements(movement_authenticity);
CREATE INDEX IF NOT EXISTS idx_line_movements_recommendation ON public.line_movements(recommendation);