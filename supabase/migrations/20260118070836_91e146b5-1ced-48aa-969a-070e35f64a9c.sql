-- Add columns to track actual bookmaker lines and recalculated hit rates
ALTER TABLE category_sweet_spots 
ADD COLUMN IF NOT EXISTS actual_line DECIMAL(5,1),
ADD COLUMN IF NOT EXISTS actual_hit_rate DECIMAL(3,2),
ADD COLUMN IF NOT EXISTS line_difference DECIMAL(5,1),
ADD COLUMN IF NOT EXISTS bookmaker TEXT;