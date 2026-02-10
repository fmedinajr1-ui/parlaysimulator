
-- Phase 1a: Create ncaab_player_game_logs table
CREATE TABLE public.ncaab_player_game_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  team TEXT,
  game_date DATE NOT NULL,
  opponent TEXT,
  minutes_played NUMERIC,
  points INTEGER DEFAULT 0,
  rebounds INTEGER DEFAULT 0,
  assists INTEGER DEFAULT 0,
  threes_made INTEGER DEFAULT 0,
  blocks INTEGER DEFAULT 0,
  steals INTEGER DEFAULT 0,
  turnovers INTEGER DEFAULT 0,
  is_home BOOLEAN,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT ncaab_player_game_logs_unique UNIQUE (player_name, game_date)
);

ALTER TABLE public.ncaab_player_game_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access on ncaab_player_game_logs"
  ON public.ncaab_player_game_logs FOR SELECT
  USING (true);

CREATE INDEX idx_ncaab_game_logs_player ON public.ncaab_player_game_logs (player_name);
CREATE INDEX idx_ncaab_game_logs_date ON public.ncaab_player_game_logs (game_date);
CREATE INDEX idx_ncaab_game_logs_team ON public.ncaab_player_game_logs (team);

-- Phase 1b: Create ncaab_team_stats table
CREATE TABLE public.ncaab_team_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name TEXT NOT NULL,
  conference TEXT,
  kenpom_rank INTEGER,
  adj_offense NUMERIC,
  adj_defense NUMERIC,
  adj_tempo NUMERIC,
  home_record TEXT,
  away_record TEXT,
  ats_record TEXT,
  over_under_record TEXT,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT ncaab_team_stats_unique UNIQUE (team_name)
);

ALTER TABLE public.ncaab_team_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access on ncaab_team_stats"
  ON public.ncaab_team_stats FOR SELECT
  USING (true);
