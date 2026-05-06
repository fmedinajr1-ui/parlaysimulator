ALTER TABLE public.nuke_parlays
  ADD COLUMN IF NOT EXISTS sport text NOT NULL DEFAULT 'basketball_nba';

CREATE INDEX IF NOT EXISTS idx_nuke_parlays_sport_date
  ON public.nuke_parlays(sport, game_date DESC);
