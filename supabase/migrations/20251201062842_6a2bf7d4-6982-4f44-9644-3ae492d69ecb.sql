-- Add final_pick and is_primary_record columns to line_movements
ALTER TABLE public.line_movements ADD COLUMN IF NOT EXISTS final_pick TEXT;
ALTER TABLE public.line_movements ADD COLUMN IF NOT EXISTS is_primary_record BOOLEAN DEFAULT true;