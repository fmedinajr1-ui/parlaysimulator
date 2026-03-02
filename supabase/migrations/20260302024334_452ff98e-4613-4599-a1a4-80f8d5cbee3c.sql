CREATE TABLE public.dd_td_predictions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  prediction_date DATE NOT NULL,
  player_name TEXT NOT NULL,
  prediction_type TEXT NOT NULL DEFAULT 'DD',
  season_rate NUMERIC,
  home_away_rate NUMERIC,
  vs_opponent_rate NUMERIC,
  l10_rate NUMERIC,
  composite_score NUMERIC,
  opponent TEXT,
  is_home BOOLEAN,
  near_miss_rate NUMERIC,
  games_played INTEGER,
  outcome TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);