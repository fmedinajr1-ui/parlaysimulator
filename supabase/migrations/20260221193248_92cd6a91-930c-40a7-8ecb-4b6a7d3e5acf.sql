
ALTER TABLE public.mispriced_lines 
ADD COLUMN IF NOT EXISTS defense_adjusted_avg numeric,
ADD COLUMN IF NOT EXISTS opponent_defense_rank integer;
