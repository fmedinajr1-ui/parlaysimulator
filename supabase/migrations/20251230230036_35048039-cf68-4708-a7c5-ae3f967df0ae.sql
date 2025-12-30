-- Add unique constraint on parlay_id and leg_index for upsert support
ALTER TABLE public.daily_elite_leg_outcomes 
ADD CONSTRAINT daily_elite_leg_outcomes_parlay_leg_unique 
UNIQUE (parlay_id, leg_index);