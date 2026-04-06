ALTER TABLE public.fanduel_prediction_accuracy 
ADD COLUMN IF NOT EXISTS recommended_alt_line numeric,
ADD COLUMN IF NOT EXISTS alt_line_buffer numeric,
ADD COLUMN IF NOT EXISTS alt_line_was_correct boolean;