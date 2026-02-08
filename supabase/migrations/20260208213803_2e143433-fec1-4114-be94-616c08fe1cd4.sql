-- Add last_calibrated_at column to bot_category_weights
ALTER TABLE public.bot_category_weights 
ADD COLUMN IF NOT EXISTS last_calibrated_at TIMESTAMP WITH TIME ZONE;

-- Create index for faster category/side lookups
CREATE INDEX IF NOT EXISTS idx_bot_category_weights_category_side 
ON public.bot_category_weights(category, side);

-- Create index for category_sweet_spots outcome queries
CREATE INDEX IF NOT EXISTS idx_category_sweet_spots_outcome_settled 
ON public.category_sweet_spots(outcome, settled_at) 
WHERE outcome IS NOT NULL;