-- Add selection_rationale column to daily_elite_parlays
ALTER TABLE public.daily_elite_parlays 
ADD COLUMN IF NOT EXISTS selection_rationale TEXT;

-- Delete today's parlay to allow regeneration with new algorithm
DELETE FROM public.daily_elite_parlays 
WHERE parlay_date = CURRENT_DATE;