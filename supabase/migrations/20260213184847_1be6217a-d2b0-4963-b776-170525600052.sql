
-- NCAA Baseball Player Game Logs
CREATE TABLE public.ncaa_baseball_player_game_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  team TEXT NOT NULL,
  game_date DATE NOT NULL,
  opponent TEXT NOT NULL,
  at_bats INTEGER DEFAULT 0,
  hits INTEGER DEFAULT 0,
  runs INTEGER DEFAULT 0,
  rbis INTEGER DEFAULT 0,
  home_runs INTEGER DEFAULT 0,
  stolen_bases INTEGER DEFAULT 0,
  walks INTEGER DEFAULT 0,
  strikeouts INTEGER DEFAULT 0,
  batting_avg NUMERIC(4,3) DEFAULT 0,
  innings_pitched NUMERIC(4,1) DEFAULT NULL,
  earned_runs INTEGER DEFAULT NULL,
  pitcher_strikeouts INTEGER DEFAULT NULL,
  is_home BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_name, game_date)
);

-- NCAA Baseball Team Stats
CREATE TABLE public.ncaa_baseball_team_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_name TEXT NOT NULL UNIQUE,
  espn_id TEXT,
  conference TEXT,
  national_rank INTEGER,
  runs_per_game NUMERIC(5,2),
  runs_allowed_per_game NUMERIC(5,2),
  era NUMERIC(5,2),
  batting_avg NUMERIC(4,3),
  home_record TEXT,
  away_record TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No RLS needed - service-role only access from edge functions
ALTER TABLE public.ncaa_baseball_player_game_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ncaa_baseball_team_stats ENABLE ROW LEVEL SECURITY;
