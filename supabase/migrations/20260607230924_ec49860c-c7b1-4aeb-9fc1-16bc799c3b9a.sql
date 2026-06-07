ALTER TABLE public.mlb_fair_price_events
  ADD COLUMN IF NOT EXISTS final_home_score integer,
  ADD COLUMN IF NOT EXISTS final_away_score integer,
  ADD COLUMN IF NOT EXISTS home_won boolean,
  ADD COLUMN IF NOT EXISTS outcome_attached_at timestamptz,
  ADD COLUMN IF NOT EXISTS realized_hit boolean,
  ADD COLUMN IF NOT EXISTS closing_book_implied_devig double precision,
  ADD COLUMN IF NOT EXISTS closing_attached_at timestamptz,
  ADD COLUMN IF NOT EXISTS clv_pct double precision;

CREATE INDEX IF NOT EXISTS idx_mlb_fp_pending_outcome
  ON public.mlb_fair_price_events (created_at DESC)
  WHERE outcome_attached_at IS NULL;