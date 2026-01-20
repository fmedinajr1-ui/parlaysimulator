-- Add risk_level and recommendation columns to category_sweet_spots
ALTER TABLE public.category_sweet_spots 
ADD COLUMN IF NOT EXISTS risk_level TEXT,
ADD COLUMN IF NOT EXISTS recommendation TEXT;