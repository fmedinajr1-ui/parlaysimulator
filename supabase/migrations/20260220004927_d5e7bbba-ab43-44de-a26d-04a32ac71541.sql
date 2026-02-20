
-- Create table tennis match stats table for the statistical scoring model
CREATE TABLE public.tt_match_stats (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_name TEXT NOT NULL,
  avg_match_total NUMERIC DEFAULT 80,
  avg_period_total NUMERIC DEFAULT 20,
  pct_3_sets NUMERIC DEFAULT 0.40,
  pct_4_sets NUMERIC DEFAULT 0.35,
  pct_5_sets NUMERIC DEFAULT 0.25,
  recent_over_rate NUMERIC DEFAULT 0.50,
  std_dev_total NUMERIC DEFAULT 8,
  sample_size INTEGER DEFAULT 0,
  league TEXT,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(player_name)
);

-- Enable RLS
ALTER TABLE public.tt_match_stats ENABLE ROW LEVEL SECURITY;

-- Public read access (stats are not user-specific)
CREATE POLICY "tt_match_stats_select" ON public.tt_match_stats FOR SELECT USING (true);

-- Service role only for inserts/updates (edge functions use service role)
CREATE POLICY "tt_match_stats_insert" ON public.tt_match_stats FOR INSERT WITH CHECK (true);
CREATE POLICY "tt_match_stats_update" ON public.tt_match_stats FOR UPDATE USING (true);

-- Index for player lookup
CREATE INDEX idx_tt_match_stats_player ON public.tt_match_stats (player_name);
CREATE INDEX idx_tt_match_stats_updated ON public.tt_match_stats (last_updated);
