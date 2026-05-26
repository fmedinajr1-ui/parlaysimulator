ALTER TABLE public.lag_edges
  ADD COLUMN IF NOT EXISTS intended_direction TEXT CHECK (intended_direction IN ('up','down')),
  ADD COLUMN IF NOT EXISTS hedge_fired_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hedge_snapshot_id UUID REFERENCES public.market_snapshot(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hedge_reverse_line NUMERIC,
  ADD COLUMN IF NOT EXISTS hedge_reverse_delta NUMERIC;

CREATE INDEX IF NOT EXISTS idx_lag_edges_hedge_candidates
  ON public.lag_edges (fired_at DESC)
  WHERE hedge_fired_at IS NULL AND fired_at IS NOT NULL;