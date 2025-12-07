-- Add unique constraint on parlay_type for pvs_parlays table
ALTER TABLE public.pvs_parlays 
ADD CONSTRAINT pvs_parlays_parlay_type_unique UNIQUE (parlay_type);