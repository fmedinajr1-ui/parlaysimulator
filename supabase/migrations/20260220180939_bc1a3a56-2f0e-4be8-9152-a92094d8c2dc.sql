
-- Create MLB player game logs table for historical research
CREATE TABLE public.mlb_player_game_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  team TEXT NOT NULL,
  game_date DATE NOT NULL,
  opponent TEXT,
  at_bats INTEGER DEFAULT 0,
  hits INTEGER DEFAULT 0,
  runs INTEGER DEFAULT 0,
  rbis INTEGER DEFAULT 0,
  home_runs INTEGER DEFAULT 0,
  stolen_bases INTEGER DEFAULT 0,
  walks INTEGER DEFAULT 0,
  strikeouts INTEGER DEFAULT 0,
  batting_avg NUMERIC DEFAULT 0,
  total_bases INTEGER DEFAULT 0,
  innings_pitched NUMERIC,
  earned_runs INTEGER,
  pitcher_strikeouts INTEGER,
  pitcher_hits_allowed INTEGER,
  is_home BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_name, game_date)
);

-- Enable RLS
ALTER TABLE public.mlb_player_game_logs ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Anyone can read MLB game logs"
  ON public.mlb_player_game_logs
  FOR SELECT
  USING (true);

-- Service role only for writes (handled by edge functions)
CREATE POLICY "Service role can insert MLB game logs"
  ON public.mlb_player_game_logs
  FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update MLB game logs"
  ON public.mlb_player_game_logs
  FOR UPDATE
  USING (true);

-- Index for player lookups
CREATE INDEX idx_mlb_game_logs_player ON public.mlb_player_game_logs (player_name, game_date DESC);
CREATE INDEX idx_mlb_game_logs_date ON public.mlb_player_game_logs (game_date DESC);
