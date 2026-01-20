-- Add missing columns for line-eligible and bounce-back detection
ALTER TABLE category_sweet_spots 
ADD COLUMN IF NOT EXISTS l10_std_dev NUMERIC;

ALTER TABLE category_sweet_spots 
ADD COLUMN IF NOT EXISTS bounce_back_score NUMERIC;

ALTER TABLE category_sweet_spots 
ADD COLUMN IF NOT EXISTS season_avg NUMERIC;

-- Comments for clarity
COMMENT ON COLUMN category_sweet_spots.l10_std_dev IS 'L10 standard deviation for variance analysis';
COMMENT ON COLUMN category_sweet_spots.bounce_back_score IS 'Score indicating bounce-back potential (std devs below mean)';
COMMENT ON COLUMN category_sweet_spots.season_avg IS 'Season average for bounce-back comparison';