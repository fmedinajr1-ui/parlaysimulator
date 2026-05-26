ALTER TABLE public.court_edge_picks
  ADD COLUMN IF NOT EXISTS actual_total_games numeric,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS settle_source text;

CREATE INDEX IF NOT EXISTS court_edge_picks_ungraded_idx
  ON public.court_edge_picks (commence_at)
  WHERE graded = false;