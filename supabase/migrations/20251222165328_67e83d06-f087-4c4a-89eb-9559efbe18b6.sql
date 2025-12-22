-- Create median_edge_picks table for the 5-Median Prop Edge Engine
CREATE TABLE public.median_edge_picks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  player_name TEXT NOT NULL,
  stat_type TEXT NOT NULL,
  sportsbook_line NUMERIC,
  true_median NUMERIC,
  edge NUMERIC,
  recommendation TEXT,
  confidence_flag TEXT DEFAULT 'NORMAL',
  alt_line_suggestion NUMERIC,
  reason_summary TEXT,
  m1_recent_form NUMERIC,
  m2_matchup NUMERIC,
  m3_minutes_weighted NUMERIC,
  m4_usage NUMERIC,
  m5_location NUMERIC,
  adjustments JSONB DEFAULT '{}',
  game_date DATE DEFAULT CURRENT_DATE,
  game_time TIMESTAMPTZ,
  event_id TEXT,
  team_name TEXT,
  opponent_team TEXT,
  expected_minutes NUMERIC,
  spread NUMERIC,
  injury_context TEXT DEFAULT 'none',
  odds_open NUMERIC,
  odds_current NUMERIC,
  std_dev NUMERIC,
  is_volatile BOOLEAN DEFAULT false,
  outcome TEXT DEFAULT 'pending',
  actual_value NUMERIC,
  verified_at TIMESTAMPTZ,
  sport TEXT DEFAULT 'NBA'
);

-- Enable RLS
ALTER TABLE public.median_edge_picks ENABLE ROW LEVEL SECURITY;

-- Public read access for displaying picks
CREATE POLICY "Public can view median edge picks"
ON public.median_edge_picks
FOR SELECT
USING (true);

-- Only admins/service role can insert/update
CREATE POLICY "Service role can manage median edge picks"
ON public.median_edge_picks
FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for efficient querying
CREATE INDEX idx_median_edge_picks_date ON public.median_edge_picks(game_date DESC);
CREATE INDEX idx_median_edge_picks_recommendation ON public.median_edge_picks(recommendation);
CREATE INDEX idx_median_edge_picks_outcome ON public.median_edge_picks(outcome);