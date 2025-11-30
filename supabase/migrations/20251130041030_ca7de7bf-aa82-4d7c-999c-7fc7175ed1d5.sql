-- Trigger function to recalculate calibration when parlays are settled
CREATE OR REPLACE FUNCTION public.trigger_recalculate_calibration()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Only recalculate when outcome is set
  IF NEW.parlay_outcome IS NOT NULL AND OLD.parlay_outcome IS NULL THEN
    PERFORM calculate_calibration_factors();
  END IF;
  RETURN NEW;
END;
$$;

-- Drop existing trigger if any
DROP TRIGGER IF EXISTS on_training_data_settled ON public.parlay_training_data;

-- Create the calibration trigger
CREATE TRIGGER on_training_data_settled
AFTER UPDATE ON public.parlay_training_data
FOR EACH ROW
EXECUTE FUNCTION public.trigger_recalculate_calibration();