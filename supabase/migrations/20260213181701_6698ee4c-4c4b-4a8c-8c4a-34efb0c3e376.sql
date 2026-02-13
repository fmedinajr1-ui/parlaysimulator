
ALTER TABLE public.game_bets ADD COLUMN IF NOT EXISTS composite_score NUMERIC;
ALTER TABLE public.game_bets ADD COLUMN IF NOT EXISTS score_breakdown JSONB;
