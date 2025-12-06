-- Create table to store sharp signal calibration factors
CREATE TABLE IF NOT EXISTS public.sharp_signal_calibration (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  factor_key text NOT NULL UNIQUE,
  factor_value numeric NOT NULL DEFAULT 1.0,
  description text,
  last_accuracy numeric,
  sample_size integer DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sharp_signal_calibration ENABLE ROW LEVEL SECURITY;

-- Anyone can view calibration factors
CREATE POLICY "Anyone can view calibration factors" 
ON public.sharp_signal_calibration 
FOR SELECT 
USING (true);

-- Insert default calibration values
INSERT INTO public.sharp_signal_calibration (factor_key, factor_value, description) VALUES
  ('PICK_THRESHOLD', 3, 'Minimum real score advantage for PICK recommendation'),
  ('FADE_THRESHOLD', 4, 'Minimum fake score advantage for FADE recommendation'),
  ('MIN_BOOKS_CONSENSUS', 2, 'Minimum books consensus for PICK'),
  ('HIGH_CONF_MULTIPLIER', 1.0, 'Multiplier for high confidence signals'),
  ('WEIGHT_REVERSE_LINE_MOVEMENT', 3, 'Weight for reverse line movement signal'),
  ('WEIGHT_STEAM_MOVE', 3, 'Weight for steam move signal'),
  ('WEIGHT_SHARP_TIMING', 2, 'Weight for sharp timing signal'),
  ('WEIGHT_PROFESSIONAL_SIZING', 2, 'Weight for professional sizing signal'),
  ('WEIGHT_MULTI_BOOK_CONSENSUS', 2, 'Weight for multi-book consensus signal'),
  ('WEIGHT_CLOSING_LINE_VALUE', 2, 'Weight for closing line value signal'),
  ('WEIGHT_LATE_MONEY_SWEET_SPOT', 2, 'Weight for late money sweet spot signal'),
  ('WEIGHT_SIGNIFICANT_PRICE_MOVE', 1, 'Weight for significant price move signal'),
  ('WEIGHT_MODERATE_PRICE_MOVE', 1, 'Weight for moderate price move signal'),
  ('WEIGHT_EARLY_MORNING_MOVE', -2, 'Weight for early morning move signal'),
  ('WEIGHT_SINGLE_BOOK_ONLY', -2, 'Weight for single book only signal'),
  ('WEIGHT_BOTH_SIDES_MOVING', -1, 'Weight for both sides moving signal'),
  ('WEIGHT_SMALL_MOVE', -1, 'Weight for small move signal')
ON CONFLICT (factor_key) DO NOTHING;

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_calibration_factor_key ON public.sharp_signal_calibration (factor_key);