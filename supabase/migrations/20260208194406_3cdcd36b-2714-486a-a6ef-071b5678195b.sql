-- New table for team-level bets (spreads, totals, moneylines)
CREATE TABLE public.game_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  bet_type TEXT NOT NULL, -- 'spread', 'total', 'h2h'
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  line NUMERIC,
  home_odds NUMERIC,
  away_odds NUMERIC,
  over_odds NUMERIC,
  under_odds NUMERIC,
  bookmaker TEXT NOT NULL,
  commence_time TIMESTAMPTZ NOT NULL,
  sharp_score NUMERIC,
  recommended_side TEXT,
  signal_sources JSONB,
  is_active BOOLEAN DEFAULT true,
  outcome TEXT,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_id, bet_type, bookmaker)
);

-- Tennis player stats table for historical analysis
CREATE TABLE public.tennis_player_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  match_date DATE NOT NULL,
  opponent TEXT,
  tournament TEXT,
  surface TEXT, -- hard, clay, grass
  aces INTEGER,
  double_faults INTEGER,
  first_serve_pct NUMERIC,
  games_won INTEGER,
  games_lost INTEGER,
  sets_won INTEGER,
  sets_lost INTEGER,
  is_winner BOOLEAN,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(player_name, match_date, opponent)
);

-- Enable RLS
ALTER TABLE public.game_bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tennis_player_stats ENABLE ROW LEVEL SECURITY;

-- Public read policies (betting data is public)
CREATE POLICY "Game bets are viewable by everyone" 
ON public.game_bets FOR SELECT USING (true);

CREATE POLICY "Tennis stats are viewable by everyone" 
ON public.tennis_player_stats FOR SELECT USING (true);

-- Service role insert/update policies
CREATE POLICY "Service role can insert game bets" 
ON public.game_bets FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role can update game bets" 
ON public.game_bets FOR UPDATE USING (true);

CREATE POLICY "Service role can insert tennis stats" 
ON public.tennis_player_stats FOR INSERT WITH CHECK (true);

CREATE POLICY "Service role can update tennis stats" 
ON public.tennis_player_stats FOR UPDATE USING (true);

-- Indexes for performance
CREATE INDEX idx_game_bets_sport ON public.game_bets(sport);
CREATE INDEX idx_game_bets_commence_time ON public.game_bets(commence_time);
CREATE INDEX idx_game_bets_bet_type ON public.game_bets(bet_type);
CREATE INDEX idx_game_bets_is_active ON public.game_bets(is_active);
CREATE INDEX idx_tennis_stats_player ON public.tennis_player_stats(player_name);
CREATE INDEX idx_tennis_stats_date ON public.tennis_player_stats(match_date);

-- Enable realtime for game_bets
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_bets;