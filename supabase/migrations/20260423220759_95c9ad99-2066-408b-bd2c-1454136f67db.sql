ALTER TABLE public.ocr_scanned_props
  ADD COLUMN IF NOT EXISTS recommended_side TEXT,
  ADD COLUMN IF NOT EXISTS edge_pct NUMERIC,
  ADD COLUMN IF NOT EXISTS fair_prob NUMERIC,
  ADD COLUMN IF NOT EXISTS implied_prob NUMERIC,
  ADD COLUMN IF NOT EXISTS verdict TEXT,
  ADD COLUMN IF NOT EXISTS market_over_price INTEGER,
  ADD COLUMN IF NOT EXISTS market_under_price INTEGER;

CREATE INDEX IF NOT EXISTS idx_ocr_scanned_props_session_edge
  ON public.ocr_scanned_props (session_id, edge_pct DESC);