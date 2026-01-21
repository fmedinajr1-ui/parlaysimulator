-- Create starting_lineups table to cache scraped lineup data
CREATE TABLE public.starting_lineups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_date DATE NOT NULL,
  event_id TEXT,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_starters JSONB NOT NULL DEFAULT '[]',
  away_starters JSONB NOT NULL DEFAULT '[]',
  home_bench JSONB DEFAULT '[]',
  away_bench JSONB DEFAULT '[]',
  injuries JSONB DEFAULT '[]',
  confirmed BOOLEAN DEFAULT false,
  source TEXT DEFAULT 'rotowire',
  scraped_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(game_date, home_team, away_team)
);

-- Create lineup_alerts table for player-specific risks
CREATE TABLE public.lineup_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_name TEXT NOT NULL,
  normalized_name TEXT,
  team TEXT NOT NULL,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('OUT', 'DOUBTFUL', 'QUESTIONABLE', 'PROBABLE', 'GTD', 'STARTING', 'BENCH', 'MINUTES_RISK')),
  details TEXT,
  injury_note TEXT,
  impact_level TEXT DEFAULT 'medium' CHECK (impact_level IN ('critical', 'high', 'medium', 'low', 'none')),
  game_date DATE NOT NULL,
  event_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create index for fast lookups
CREATE INDEX idx_starting_lineups_date ON public.starting_lineups(game_date);
CREATE INDEX idx_lineup_alerts_player ON public.lineup_alerts(normalized_name, game_date);
CREATE INDEX idx_lineup_alerts_date ON public.lineup_alerts(game_date);

-- Enable RLS
ALTER TABLE public.starting_lineups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lineup_alerts ENABLE ROW LEVEL SECURITY;

-- Public read access (lineup data is public)
CREATE POLICY "Anyone can read lineups" ON public.starting_lineups FOR SELECT USING (true);
CREATE POLICY "Anyone can read lineup alerts" ON public.lineup_alerts FOR SELECT USING (true);

-- Service role can insert/update
CREATE POLICY "Service can manage lineups" ON public.starting_lineups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service can manage alerts" ON public.lineup_alerts FOR ALL USING (true) WITH CHECK (true);