-- Add missing eligibility_type column to category_sweet_spots
ALTER TABLE category_sweet_spots 
ADD COLUMN IF NOT EXISTS eligibility_type TEXT;

COMMENT ON COLUMN category_sweet_spots.eligibility_type IS 
'Type of eligibility: AVG_RANGE, LINE_ELIGIBLE_OVER, BOUNCE_BACK';