ALTER TABLE bot_straight_bets 
  ADD COLUMN IF NOT EXISTS bet_type text DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS ceiling_line numeric,
  ADD COLUMN IF NOT EXISTS standard_line numeric,
  ADD COLUMN IF NOT EXISTS h2h_boost numeric,
  ADD COLUMN IF NOT EXISTS ceiling_reason text;