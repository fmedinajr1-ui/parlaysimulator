
-- Phase 1: Add ppg and oppg columns to ncaab_team_stats
ALTER TABLE public.ncaab_team_stats ADD COLUMN IF NOT EXISTS ppg numeric;
ALTER TABLE public.ncaab_team_stats ADD COLUMN IF NOT EXISTS oppg numeric;

-- Phase 2: Create team_game_results table for historical scores
CREATE TABLE IF NOT EXISTS public.team_game_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sport TEXT NOT NULL,
  game_date DATE NOT NULL,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  total_score INTEGER GENERATED ALWAYS AS (home_score + away_score) STORED,
  espn_event_id TEXT,
  season TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_team_game_results_unique 
  ON public.team_game_results (sport, game_date, home_team, away_team);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_team_game_results_sport_date 
  ON public.team_game_results (sport, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_team_game_results_home_team 
  ON public.team_game_results (home_team, game_date DESC);
CREATE INDEX IF NOT EXISTS idx_team_game_results_away_team 
  ON public.team_game_results (away_team, game_date DESC);

-- Enable RLS
ALTER TABLE public.team_game_results ENABLE ROW LEVEL SECURITY;

-- Public read access (game results are public data)
CREATE POLICY "Anyone can read game results"
  ON public.team_game_results FOR SELECT USING (true);

-- Service role can insert/update
CREATE POLICY "Service role can manage game results"
  ON public.team_game_results FOR ALL
  USING (true) WITH CHECK (true);
