
-- NHL Goalie Game Logs for L10 analysis
CREATE TABLE public.nhl_goalie_game_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  game_date DATE NOT NULL,
  opponent TEXT,
  is_home BOOLEAN DEFAULT false,
  saves INTEGER DEFAULT 0,
  shots_against INTEGER DEFAULT 0,
  goals_against INTEGER DEFAULT 0,
  save_pct NUMERIC(5,3) DEFAULT 0,
  minutes_played INTEGER DEFAULT 0,
  win BOOLEAN DEFAULT false,
  shutout BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(player_name, game_date)
);

-- NHL Team Defense/Offense Rankings for matchup scoring
CREATE TABLE public.nhl_team_defense_rankings (
  team_abbrev TEXT PRIMARY KEY,
  team_name TEXT,
  goals_for_rank INTEGER,
  goals_against_rank INTEGER,
  shots_for_rank INTEGER,
  shots_against_rank INTEGER,
  power_play_rank INTEGER,
  penalty_kill_rank INTEGER,
  goals_for_per_game NUMERIC(5,2) DEFAULT 0,
  goals_against_per_game NUMERIC(5,2) DEFAULT 0,
  shots_for_per_game NUMERIC(5,2) DEFAULT 0,
  shots_against_per_game NUMERIC(5,2) DEFAULT 0,
  power_play_pct NUMERIC(5,2) DEFAULT 0,
  penalty_kill_pct NUMERIC(5,2) DEFAULT 0,
  season TEXT DEFAULT '20242025',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS disabled for service-role-only access (edge functions use service role key)
ALTER TABLE public.nhl_goalie_game_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhl_team_defense_rankings ENABLE ROW LEVEL SECURITY;

-- Allow public read for the app
CREATE POLICY "Allow public read nhl_goalie_game_logs" ON public.nhl_goalie_game_logs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow public read nhl_team_defense_rankings" ON public.nhl_team_defense_rankings FOR SELECT TO anon, authenticated USING (true);
